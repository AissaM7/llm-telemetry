// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Anthropic SDK Instrumentation
// ═══════════════════════════════════════════════════════════════════
// Uses JavaScript Proxy to intercept method calls on the Anthropic client.

import { LLMTracer } from '../core/tracer';
import { nowMs } from '../core/clock';

/**
 * Instrument an Anthropic client instance with automatic tracing.
 * Uses Proxy to intercept client.messages.create() transparently.
 *
 * @example
 * const anthropic = instrumentAnthropic(new Anthropic({ apiKey: '...' }));
 * const message = await anthropic.messages.create({ ... });
 */
export function instrumentAnthropic<T extends object>(client: T): T {
    const tracer = LLMTracer.getInstance();

    return new Proxy(client, {
        get(target: T, prop: string | symbol): unknown {
            const value = (target as Record<string | symbol, unknown>)[prop];

            if (prop === 'messages' && value && typeof value === 'object') {
                return instrumentMessagesNamespace(value as object, tracer);
            }

            return value;
        },
    });
}

/**
 * Wrap the messages namespace to intercept messages.create()
 */
function instrumentMessagesNamespace(messages: object, tracer: LLMTracer): object {
    return new Proxy(messages, {
        get(target: object, prop: string | symbol): unknown {
            const value = (target as Record<string | symbol, unknown>)[prop];

            if (prop === 'create' && typeof value === 'function') {
                return function instrumentedCreate(this: unknown, ...args: unknown[]): unknown {
                    return instrumentMessagesCreate(value.bind(target), args, tracer);
                };
            }

            return value;
        },
    });
}

/**
 * Instrument a messages.create() call.
 */
async function instrumentMessagesCreate(
    originalFn: (...args: unknown[]) => unknown,
    args: unknown[],
    tracer: LLMTracer
): Promise<unknown> {
    const params = (args[0] ?? {}) as Record<string, unknown>;
    const isStreaming = params.stream === true;

    const span = tracer.startSpan('llm.anthropic.chat_completion', {
        attributes: {
            'llm.provider': 'anthropic',
            'llm.streaming': isStreaming,
        } as Record<string, string | boolean>,
    });

    const startTime = nowMs();
    const sanitizer = tracer.getSanitizer();

    // Extract pre-call attributes
    if (typeof params.model === 'string') {
        span.setAttribute('llm.model', params.model);
        span.setAttribute('gen_ai.request.model', params.model);
        span.setAttribute('gen_ai.system', 'anthropic');
    }
    if (typeof params.max_tokens === 'number') {
        span.setAttribute('llm.max_tokens', params.max_tokens);
        span.setAttribute('gen_ai.request.max_tokens', params.max_tokens);
    }
    if (typeof params.temperature === 'number') {
        span.setAttribute('llm.temperature', params.temperature);
        span.setAttribute('gen_ai.request.temperature', params.temperature);
    }

    // Hash system prompt
    if (typeof params.system === 'string' && sanitizer) {
        span.setAttribute('llm.system_prompt_hash', sanitizer.hashString(params.system));
    }

    // Capture user message
    const messages = params.messages as Array<{ role: string; content: string | Array<{ text?: string }> }> | undefined;
    if (messages && sanitizer) {
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
        if (lastUserMsg) {
            const content = typeof lastUserMsg.content === 'string'
                ? lastUserMsg.content
                : lastUserMsg.content?.[0]?.text ?? '';
            if (content) {
                span.setAttribute('llm.prompt', sanitizer.sanitize(content));
            }
        }
    }

    try {
        const result = await (originalFn(...args) as Promise<unknown>);
        const latencyMs = nowMs() - startTime;
        span.setAttribute('llm.latency_ms', Math.round(latencyMs));

        if (isStreaming) {
            // Wrap the streaming response
            return wrapAnthropicStream(result as AsyncIterable<unknown>, span, tracer, startTime);
        }

        // Non-streaming response
        const response = result as Record<string, unknown>;

        // Extract usage (Anthropic format)
        const usage = response.usage as Record<string, number> | undefined;
        if (usage) {
            if (usage.input_tokens !== undefined) {
                span.setAttribute('llm.prompt_tokens', usage.input_tokens);
                span.setAttribute('gen_ai.usage.input_tokens', usage.input_tokens);
            }
            if (usage.output_tokens !== undefined) {
                span.setAttribute('llm.completion_tokens', usage.output_tokens);
                span.setAttribute('gen_ai.usage.output_tokens', usage.output_tokens);
            }
            const total = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
            if (total > 0) {
                span.setAttribute('llm.total_tokens', total);
            }
        }

        // Extract stop_reason as finish_reason
        if (typeof response.stop_reason === 'string') {
            span.setAttribute('llm.finish_reason', response.stop_reason);
        }

        // Extract response content
        const content = response.content as Array<{ type: string; text?: string }> | undefined;
        if (content?.[0]?.text && sanitizer) {
            span.setAttribute('llm.response', sanitizer.sanitize(content[0].text));
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
        throw error;
    }
}

/**
 * Wrap an Anthropic streaming response to capture TTFB and token totals.
 */
function wrapAnthropicStream(
    stream: AsyncIterable<unknown>,
    span: import('../core/span').LLMSpan,
    tracer: LLMTracer,
    startTime: number
): AsyncIterable<unknown> {
    let firstChunkReceived = false;
    let inputTokens = 0;
    let outputTokens = 0;

    const originalIterator = stream[Symbol.asyncIterator]();

    const wrappedIterator: AsyncIterator<unknown> = {
        async next(): Promise<IteratorResult<unknown>> {
            try {
                const result = await originalIterator.next();

                if (!result.done) {
                    if (!firstChunkReceived) {
                        firstChunkReceived = true;
                        const ttfb = nowMs() - startTime;
                        span.setAttribute('llm.ttfb_ms', Math.round(ttfb));
                    }

                    // Anthropic stream events include usage in message_delta
                    const event = result.value as Record<string, unknown>;
                    if (event.type === 'message_delta') {
                        const usage = event.usage as Record<string, number> | undefined;
                        if (usage?.output_tokens) outputTokens = usage.output_tokens;
                    }
                    if (event.type === 'message_start') {
                        const message = event.message as Record<string, unknown> | undefined;
                        const usage = message?.usage as Record<string, number> | undefined;
                        if (usage?.input_tokens) inputTokens = usage.input_tokens;
                    }
                }

                if (result.done) {
                    const latencyMs = nowMs() - startTime;
                    span.setAttribute('llm.latency_ms', Math.round(latencyMs));
                    if (inputTokens > 0) {
                        span.setAttribute('llm.prompt_tokens', inputTokens);
                        span.setAttribute('gen_ai.usage.input_tokens', inputTokens);
                    }
                    if (outputTokens > 0) {
                        span.setAttribute('llm.completion_tokens', outputTokens);
                        span.setAttribute('gen_ai.usage.output_tokens', outputTokens);
                    }
                    if (inputTokens + outputTokens > 0) {
                        span.setAttribute('llm.total_tokens', inputTokens + outputTokens);
                    }
                    span.setStatus('OK');
                    tracer.endSpan(span);
                }

                return result;
            } catch (error) {
                const latencyMs = nowMs() - startTime;
                span.setAttribute('llm.latency_ms', Math.round(latencyMs));
                if (error instanceof Error) span.recordException(error);
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
