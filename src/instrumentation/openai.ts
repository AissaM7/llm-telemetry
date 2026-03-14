// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — OpenAI SDK Instrumentation
// ═══════════════════════════════════════════════════════════════════
// Uses JavaScript Proxy to intercept method calls on the OpenAI client.
// Works with any version of the openai npm package.

import { LLMTracer } from '../core/tracer';
import { nowMs } from '../core/clock';
import { SpanKind } from '../types';

/**
 * Instrument an OpenAI client instance with automatic tracing.
 * Uses Proxy to intercept chat.completions.create(), embeddings.create(),
 * and responses.create() transparently.
 *
 * @example
 * const openai = instrumentOpenAI(new OpenAI({ apiKey: '...' }));
 * // All subsequent calls are automatically traced
 * const response = await openai.chat.completions.create({ ... });
 */
export function instrumentOpenAI<T extends object>(client: T): T {
    const tracer = LLMTracer.getInstance();

    return new Proxy(client, {
        get(target: T, prop: string | symbol): unknown {
            const value = (target as Record<string | symbol, unknown>)[prop];

            // Instrument chat.completions
            if (prop === 'chat' && value && typeof value === 'object') {
                return instrumentChatNamespace(value as object, tracer);
            }

            // Instrument embeddings
            if (prop === 'embeddings' && value && typeof value === 'object') {
                return instrumentEmbeddingsNamespace(value as object, tracer);
            }

            // Instrument responses (new API)
            if (prop === 'responses' && value && typeof value === 'object') {
                return instrumentResponsesNamespace(value as object, tracer);
            }

            return value;
        },
    });
}

/**
 * Wrap the chat namespace to intercept chat.completions.create()
 */
function instrumentChatNamespace(chat: object, tracer: LLMTracer): object {
    return new Proxy(chat, {
        get(target: object, prop: string | symbol): unknown {
            const value = (target as Record<string | symbol, unknown>)[prop];

            if (prop === 'completions' && value && typeof value === 'object') {
                return instrumentCompletionsNamespace(value as object, tracer);
            }

            return value;
        },
    });
}

/**
 * Wrap the completions namespace to intercept completions.create()
 */
function instrumentCompletionsNamespace(completions: object, tracer: LLMTracer): object {
    return new Proxy(completions, {
        get(target: object, prop: string | symbol): unknown {
            const value = (target as Record<string | symbol, unknown>)[prop];

            if (prop === 'create' && typeof value === 'function') {
                return function instrumentedCreate(this: unknown, ...args: unknown[]): unknown {
                    return instrumentChatCreate(value.bind(target), args, tracer);
                };
            }

            return value;
        },
    });
}

/**
 * Instrument a chat.completions.create() call.
 */
async function instrumentChatCreate(
    originalFn: (...args: unknown[]) => unknown,
    args: unknown[],
    tracer: LLMTracer
): Promise<unknown> {
    const params = (args[0] ?? {}) as Record<string, unknown>;
    const isStreaming = params.stream === true;
    const span = tracer.startSpan('llm.openai.chat_completion', {
        attributes: {
            'llm.provider': 'openai',
            'llm.streaming': isStreaming,
        } as Record<string, string | boolean>,
    });

    const startTime = nowMs();
    const sanitizer = tracer.getSanitizer();

    // Extract pre-call attributes
    if (typeof params.model === 'string') {
        span.setAttribute('llm.model', params.model);
        span.setAttribute('gen_ai.request.model', params.model);
        span.setAttribute('gen_ai.system', 'openai');
    }
    if (typeof params.temperature === 'number') {
        span.setAttribute('llm.temperature', params.temperature);
        span.setAttribute('gen_ai.request.temperature', params.temperature);
    }
    if (typeof params.max_tokens === 'number') {
        span.setAttribute('llm.max_tokens', params.max_tokens);
        span.setAttribute('gen_ai.request.max_tokens', params.max_tokens);
    }

    // Hash system prompt for change detection
    const messages = params.messages as Array<{ role: string; content: string }> | undefined;
    if (messages && sanitizer) {
        const systemMsg = messages.find((m) => m.role === 'system');
        if (systemMsg?.content) {
            span.setAttribute('llm.system_prompt_hash', sanitizer.hashString(systemMsg.content));
        }
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
        if (lastUserMsg?.content) {
            span.setAttribute('llm.prompt', sanitizer.sanitize(lastUserMsg.content));
        }
    }

    try {
        const result = await (originalFn(...args) as Promise<unknown>);
        const latencyMs = nowMs() - startTime;
        span.setAttribute('llm.latency_ms', Math.round(latencyMs));

        if (isStreaming) {
            // For streaming, wrap the async iterator
            return wrapStreamingResponse(result as AsyncIterable<unknown>, span, tracer, startTime);
        }

        // Non-streaming response
        const response = result as Record<string, unknown>;

        // Extract usage
        const usage = response.usage as Record<string, number> | undefined;
        if (usage) {
            if (usage.prompt_tokens !== undefined) {
                span.setAttribute('llm.prompt_tokens', usage.prompt_tokens);
                span.setAttribute('gen_ai.usage.input_tokens', usage.prompt_tokens);
            }
            if (usage.completion_tokens !== undefined) {
                span.setAttribute('llm.completion_tokens', usage.completion_tokens);
                span.setAttribute('gen_ai.usage.output_tokens', usage.completion_tokens);
            }
            if (usage.total_tokens !== undefined) {
                span.setAttribute('llm.total_tokens', usage.total_tokens);
            }
        }

        // Extract finish reason & content
        const choices = response.choices as Array<Record<string, unknown>> | undefined;
        if (choices?.[0]) {
            const choice = choices[0];
            if (typeof choice.finish_reason === 'string') {
                span.setAttribute('llm.finish_reason', choice.finish_reason);
            }
            const message = choice.message as Record<string, unknown> | undefined;
            if (message?.content && typeof message.content === 'string' && sanitizer) {
                span.setAttribute('llm.response', sanitizer.sanitize(message.content));
            }
            // Tool calls
            const toolCalls = message?.tool_calls as Array<{ function: { name: string } }> | undefined;
            if (toolCalls && toolCalls.length > 0) {
                const names = toolCalls.map((tc) => tc.function?.name).filter(Boolean);
                span.setAttribute('llm.tool_calls', JSON.stringify(names));
                span.setAttribute('llm.tool_call_count', toolCalls.length);
            }
        }

        // Request ID
        if (typeof response.id === 'string') {
            span.setAttribute('llm.request_id', response.id);
        }

        span.setStatus('OK');
        tracer.endSpan(span);
        return result;
    } catch (error) {
        const latencyMs = nowMs() - startTime;
        span.setAttribute('llm.latency_ms', Math.round(latencyMs));

        if (error instanceof Error) {
            span.recordException(error);
            const httpError = error as Error & { status?: number };
            if (httpError.status) {
                span.setAttribute('error.status_code', httpError.status);
            }
        } else {
            span.setStatus('ERROR', String(error));
        }

        tracer.endSpan(span);
        throw error; // Always re-throw
    }
}

/**
 * Wrap a streaming response async iterator to capture TTFB and token totals.
 */
function wrapStreamingResponse(
    stream: AsyncIterable<unknown>,
    span: import('../core/span').LLMSpan,
    tracer: LLMTracer,
    startTime: number
): AsyncIterable<unknown> {
    let firstChunkReceived = false;
    let totalTokens = 0;

    const originalIterator = stream[Symbol.asyncIterator]();

    const wrappedIterator: AsyncIterator<unknown> = {
        async next(): Promise<IteratorResult<unknown>> {
            try {
                const result = await originalIterator.next();

                if (!result.done) {
                    // Capture TTFB
                    if (!firstChunkReceived) {
                        firstChunkReceived = true;
                        const ttfb = nowMs() - startTime;
                        span.setAttribute('llm.ttfb_ms', Math.round(ttfb));
                    }

                    // Accumulate token count from stream chunks if available
                    const chunk = result.value as Record<string, unknown>;
                    const usage = chunk.usage as Record<string, number> | undefined;
                    if (usage?.total_tokens) {
                        totalTokens = usage.total_tokens;
                    }
                }

                if (result.done) {
                    // Stream exhausted — end the span
                    const latencyMs = nowMs() - startTime;
                    span.setAttribute('llm.latency_ms', Math.round(latencyMs));
                    if (totalTokens > 0) {
                        span.setAttribute('llm.total_tokens', totalTokens);
                    }
                    span.setStatus('OK');
                    tracer.endSpan(span);
                }

                return result;
            } catch (error) {
                const latencyMs = nowMs() - startTime;
                span.setAttribute('llm.latency_ms', Math.round(latencyMs));
                if (error instanceof Error) {
                    span.recordException(error);
                }
                tracer.endSpan(span);
                throw error;
            }
        },
    };

    return {
        [Symbol.asyncIterator]() {
            return wrappedIterator;
        },
    };
}

/**
 * Wrap the embeddings namespace to intercept embeddings.create()
 */
function instrumentEmbeddingsNamespace(embeddings: object, tracer: LLMTracer): object {
    return new Proxy(embeddings, {
        get(target: object, prop: string | symbol): unknown {
            const value = (target as Record<string | symbol, unknown>)[prop];

            if (prop === 'create' && typeof value === 'function') {
                return async function instrumentedEmbeddingCreate(this: unknown, ...args: unknown[]): Promise<unknown> {
                    const params = (args[0] ?? {}) as Record<string, unknown>;
                    const span = tracer.startSpan('llm.openai.embedding', {
                        attributes: {
                            'llm.provider': 'openai',
                            'llm.streaming': false,
                        } as Record<string, string | boolean>,
                    });

                    const startTime = nowMs();

                    if (typeof params.model === 'string') {
                        span.setAttribute('llm.model', params.model);
                        span.setAttribute('rag.embedding_model', params.model);
                    }
                    if (typeof params.input === 'string') {
                        span.setAttribute('rag.embedding_input_length', params.input.length);
                    }

                    try {
                        const result = await (value as Function).apply(target, args);
                        const latencyMs = nowMs() - startTime;
                        span.setAttribute('llm.latency_ms', Math.round(latencyMs));
                        span.setAttribute('rag.embedding_latency_ms', Math.round(latencyMs));

                        const response = result as Record<string, unknown>;
                        const usage = response.usage as Record<string, number> | undefined;
                        if (usage?.total_tokens !== undefined) {
                            span.setAttribute('llm.total_tokens', usage.total_tokens);
                        }

                        const data = response.data as Array<{ embedding?: number[] }> | undefined;
                        if (data?.[0]?.embedding) {
                            span.setAttribute('rag.embedding_dimensions', data[0].embedding.length);
                        }

                        span.setStatus('OK');
                        tracer.endSpan(span);
                        return result;
                    } catch (error) {
                        const latencyMs = nowMs() - startTime;
                        span.setAttribute('llm.latency_ms', Math.round(latencyMs));
                        if (error instanceof Error) span.recordException(error);
                        tracer.endSpan(span);
                        throw error;
                    }
                };
            }

            return value;
        },
    });
}

/**
 * Wrap the responses namespace to intercept responses.create()
 */
function instrumentResponsesNamespace(responses: object, tracer: LLMTracer): object {
    return new Proxy(responses, {
        get(target: object, prop: string | symbol): unknown {
            const value = (target as Record<string | symbol, unknown>)[prop];

            if (prop === 'create' && typeof value === 'function') {
                return async function instrumentedResponseCreate(this: unknown, ...args: unknown[]): Promise<unknown> {
                    const params = (args[0] ?? {}) as Record<string, unknown>;
                    const span = tracer.startSpan('llm.openai.response', {
                        attributes: {
                            'llm.provider': 'openai',
                            'llm.streaming': false,
                        } as Record<string, string | boolean>,
                    });

                    const startTime = nowMs();

                    if (typeof params.model === 'string') {
                        span.setAttribute('llm.model', params.model);
                    }

                    try {
                        const result = await (value as Function).apply(target, args);
                        const latencyMs = nowMs() - startTime;
                        span.setAttribute('llm.latency_ms', Math.round(latencyMs));

                        const response = result as Record<string, unknown>;
                        const usage = response.usage as Record<string, number> | undefined;
                        if (usage) {
                            if (usage.input_tokens !== undefined) span.setAttribute('llm.prompt_tokens', usage.input_tokens);
                            if (usage.output_tokens !== undefined) span.setAttribute('llm.completion_tokens', usage.output_tokens);
                            if (usage.total_tokens !== undefined) span.setAttribute('llm.total_tokens', usage.total_tokens);
                        }

                        span.setStatus('OK');
                        tracer.endSpan(span);
                        return result;
                    } catch (error) {
                        const latencyMs = nowMs() - startTime;
                        span.setAttribute('llm.latency_ms', Math.round(latencyMs));
                        if (error instanceof Error) span.recordException(error);
                        tracer.endSpan(span);
                        throw error;
                    }
                };
            }

            return value;
        },
    });
}
