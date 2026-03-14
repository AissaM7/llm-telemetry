// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Fetch Interceptor
// ═══════════════════════════════════════════════════════════════════
// Monkey-patches global fetch() to auto-detect and instrument
// outgoing LLM API calls with zero code changes.

import { LLMTracer } from '../core/tracer';
import { SpanKind } from '../types';
import { nowMs } from '../core/clock';
import { getTraceHeaders } from '../core/context';

// ─── Known LLM API URL Patterns ─────────────────────────────────

interface ProviderPattern {
    pattern: RegExp;
    provider: string;
    spanName: string;
}

const KNOWN_PATTERNS: ProviderPattern[] = [
    // OpenAI
    { pattern: /api\.openai\.com\/v1\/chat\/completions/i, provider: 'openai', spanName: 'llm.chat_completion' },
    { pattern: /api\.openai\.com\/v1\/embeddings/i, provider: 'openai', spanName: 'llm.embedding' },
    { pattern: /api\.openai\.com\/v1\/responses/i, provider: 'openai', spanName: 'llm.chat_completion' },
    // Anthropic
    { pattern: /api\.anthropic\.com\/v1\/messages/i, provider: 'anthropic', spanName: 'llm.chat_completion' },
    // Google Gemini
    { pattern: /generativelanguage\.googleapis\.com/i, provider: 'google', spanName: 'llm.chat_completion' },
    // Cohere
    { pattern: /api\.cohere\.ai\/v1\/generate/i, provider: 'cohere', spanName: 'llm.completion' },
    { pattern: /api\.cohere\.ai\/v1\/chat/i, provider: 'cohere', spanName: 'llm.chat_completion' },
    // Mistral
    { pattern: /api\.mistral\.ai\/v1\/chat\/completions/i, provider: 'mistral', spanName: 'llm.chat_completion' },
    // Together AI
    { pattern: /api\.together\.xyz\/v1\/chat\/completions/i, provider: 'together', spanName: 'llm.chat_completion' },
    // OpenRouter
    { pattern: /openrouter\.ai\/api\/v1\/chat\/completions/i, provider: 'openrouter', spanName: 'llm.chat_completion' },
    // Generic patterns
    { pattern: /\/v1\/chat\/completions/i, provider: 'custom', spanName: 'llm.chat_completion' },
    { pattern: /\/v1\/completions/i, provider: 'custom', spanName: 'llm.completion' },
    { pattern: /\/v1\/embeddings/i, provider: 'custom', spanName: 'llm.embedding' },
];

// ─── State ──────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch | null = null;
let installed = false;
let additionalPatterns: ProviderPattern[] = [];

interface InterceptorOptions {
    additionalPatterns?: string[];
    captureRequestBody?: boolean;
    captureResponseBody?: boolean;
    injectTraceHeaders?: boolean;
}

function matchUrl(url: string): ProviderPattern | null {
    // SECURITY: Never intercept our own telemetry exporter!
    // This prevents an infinite loop where the exporter's fetch()
    // creates a new trace, which gets exported, creating a new trace...
    if (url.includes('telemetry-ingest')) {
        return null;
    }

    // Check provider-specific patterns first (before generic ones)
    for (const pattern of KNOWN_PATTERNS) {
        if (pattern.pattern.test(url)) {
            return pattern;
        }
    }

    // Check additional user-registered patterns
    for (const pattern of additionalPatterns) {
        if (pattern.pattern.test(url)) {
            return pattern;
        }
    }

    return null;
}

/**
 * Try to parse token usage from response body.
 * Handles OpenAI, Anthropic, and other common formats.
 */
function extractTokenUsage(body: Record<string, unknown>): {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    finishReason?: string;
    model?: string;
    requestId?: string;
} {
    const result: ReturnType<typeof extractTokenUsage> = {};

    // OpenAI format
    const usage = body.usage as Record<string, number> | undefined;
    if (usage) {
        result.promptTokens = usage.prompt_tokens ?? usage.input_tokens;
        result.completionTokens = usage.completion_tokens ?? usage.output_tokens;
        result.totalTokens = usage.total_tokens;
    }

    // Model
    if (typeof body.model === 'string') {
        result.model = body.model;
    }

    // Request ID
    if (typeof body.id === 'string') {
        result.requestId = body.id;
    }

    // Finish reason (OpenAI)
    const choices = body.choices as Array<Record<string, unknown>> | undefined;
    if (choices?.[0]?.finish_reason && typeof choices[0].finish_reason === 'string') {
        result.finishReason = choices[0].finish_reason;
    }

    // Anthropic stop_reason
    if (typeof body.stop_reason === 'string') {
        result.finishReason = body.stop_reason;
    }

    return result;
}

/**
 * Install the fetch interceptor to auto-instrument LLM API calls.
 *
 * @returns Uninstall function
 */
export function installFetchInterceptor(
    tracer: LLMTracer,
    options?: InterceptorOptions
): () => void {
    if (installed) {
        console.warn('[LLMTelemetry] Fetch interceptor already installed');
        return uninstallFetchInterceptor;
    }

    const captureRequestBody = options?.captureRequestBody ?? true;
    const captureResponseBody = options?.captureResponseBody ?? true;
    const injectHeaders = options?.injectTraceHeaders ?? true;

    // Register additional patterns
    if (options?.additionalPatterns) {
        for (const pattern of options.additionalPatterns) {
            additionalPatterns.push({
                pattern: new RegExp(pattern, 'i'),
                provider: 'custom',
                spanName: 'llm.api_call',
            });
        }
    }

    // Save original fetch
    originalFetch = globalThis.fetch;

    // Replace global fetch
    globalThis.fetch = async function interceptedFetch(
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : (input as Request).url;

        // Skip internal SDK calls (e.g. evaluation grader requests)
        // These carry the X-LLM-Telemetry-Internal header set by grader.ts
        const reqHeaders = new Headers(init?.headers);
        if (reqHeaders.get('X-LLM-Telemetry-Internal') === 'true') {
            return originalFetch!(input, init);
        }

        // Skip if a traceLLM() span is already in flight for this call.
        // This prevents the fetch interceptor from creating a duplicate span
        // when both traceLLM() and installFetchInterceptor() are active.
        try {
            if (tracer.isTracingActive()) {
                return originalFetch!(input, init);
            }
        } catch {
            // Never throw — fall through to normal interception
        }

        const match = matchUrl(url);

        // Not an LLM call — pass through unchanged
        if (!match) {
            return originalFetch!(input, init);
        }

        // Create span for this LLM call
        const span = tracer.startSpan(match.spanName, {
            attributes: {
                'llm.provider': match.provider,
                'llm.streaming': false,
            } as Partial<import('../types').LLMSpanAttributes>,
        });

        const startTime = nowMs();

        // Inject trace headers
        const headers = new Headers(init?.headers);
        if (injectHeaders) {
            const traceHeaders = getTraceHeaders(span.traceId, span.spanId);
            for (const [key, value] of Object.entries(traceHeaders)) {
                headers.set(key, value);
            }
        }

        // Capture request body for model/prompt info
        if (captureRequestBody && init?.body) {
            try {
                const bodyStr = typeof init.body === 'string' ? init.body : undefined;
                if (bodyStr) {
                    const bodyJson = JSON.parse(bodyStr) as Record<string, unknown>;
                    if (typeof bodyJson.model === 'string') {
                        span.setAttribute('llm.model', bodyJson.model);
                        span.setAttribute('gen_ai.request.model', bodyJson.model);
                    }
                    if (typeof bodyJson.temperature === 'number') {
                        span.setAttribute('llm.temperature', bodyJson.temperature);
                    }
                    if (typeof bodyJson.max_tokens === 'number') {
                        span.setAttribute('llm.max_tokens', bodyJson.max_tokens);
                    }
                    if (bodyJson.stream === true) {
                        span.setAttribute('llm.streaming', true);
                    }

                    // Sanitize and store prompt
                    const sanitizer = tracer.getSanitizer();
                    const messages = bodyJson.messages as Array<Record<string, string>> | undefined;
                    if (messages && messages.length > 0) {
                        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
                        if (lastUserMsg && sanitizer) {
                            span.setAttribute('llm.prompt', sanitizer.sanitize(lastUserMsg.content || ''));
                        }
                    }
                }
            } catch {
                // Body parsing failure is non-fatal
            }
        }

        try {
            const response = await originalFetch!(input, { ...init, headers });
            const latencyMs = nowMs() - startTime;

            span.setAttribute('llm.latency_ms', Math.round(latencyMs));
            span.setAttribute('error.status_code', response.status);

            if (!response.ok) {
                span.setStatus('ERROR', `HTTP ${response.status}`);
                span.setAttribute('error.type', 'http');
                span.setAttribute('error.message', `HTTP ${response.status} ${response.statusText}`);
            } else {
                span.setStatus('OK');
            }

            // Parse response body for token usage
            if (captureResponseBody && response.ok) {
                try {
                    const cloned = response.clone();
                    const responseBody = await cloned.json() as Record<string, unknown>;
                    const tokenUsage = extractTokenUsage(responseBody);

                    if (tokenUsage.promptTokens !== undefined) {
                        span.setAttribute('llm.prompt_tokens', tokenUsage.promptTokens);
                        span.setAttribute('gen_ai.usage.input_tokens', tokenUsage.promptTokens);
                    }
                    if (tokenUsage.completionTokens !== undefined) {
                        span.setAttribute('llm.completion_tokens', tokenUsage.completionTokens);
                        span.setAttribute('gen_ai.usage.output_tokens', tokenUsage.completionTokens);
                    }
                    if (tokenUsage.totalTokens !== undefined) {
                        span.setAttribute('llm.total_tokens', tokenUsage.totalTokens);
                    }
                    if (tokenUsage.finishReason) {
                        span.setAttribute('llm.finish_reason', tokenUsage.finishReason);
                    }
                    if (tokenUsage.model) {
                        span.setAttribute('llm.model', tokenUsage.model);
                    }
                    if (tokenUsage.requestId) {
                        span.setAttribute('llm.request_id', tokenUsage.requestId);
                    }

                    // ── Supabase Edge Function: chat-assistant ──
                    // Response schema: { message: string, events: any[] | null }
                    // Request schema:  { message: string, user_id: string, conversation_history: [] }
                    const sanitizer = tracer.getSanitizer();
                    const isChatAssistant = url.includes('functions/v1/chat-assistant');

                    if (isChatAssistant) {
                        // Extract AI response text
                        if (typeof responseBody.message === 'string' && sanitizer) {
                            span.setAttribute('llm.response', sanitizer.sanitize(responseBody.message));
                        }

                        // Extract events count as documents retrieved
                        const events = responseBody.events as unknown[] | null;
                        if (Array.isArray(events)) {
                            span.setAttribute('rag.documents_retrieved', events.length);
                            // Serialize events as rag.documents for the hallucination scorer
                            try {
                                const docStrings = events.map((e) =>
                                    typeof e === 'string' ? e : JSON.stringify(e)
                                );
                                span.setAttribute('rag.documents', JSON.stringify(docStrings));
                            } catch {
                                // Serialization failure is non-fatal
                            }
                        }

                        // Extract the user query from the original request body
                        if (captureRequestBody && init?.body) {
                            try {
                                const reqStr = typeof init.body === 'string' ? init.body : undefined;
                                if (reqStr) {
                                    const reqJson = JSON.parse(reqStr) as Record<string, unknown>;
                                    if (typeof reqJson.message === 'string' && sanitizer) {
                                        span.setAttribute('rag.query', sanitizer.sanitize(reqJson.message));
                                    }
                                }
                            } catch {
                                // Request body re-parse failure is non-fatal
                            }
                        }

                        span.setAttribute('llm.provider', 'supabase-edge');
                        span.setAttribute('llm.model', 'gpt-4o');
                    }

                    // Capture sanitized response (OpenAI format)
                    const choices = responseBody.choices as Array<{ message?: { content?: string } }> | undefined;
                    if (choices?.[0]?.message?.content && sanitizer) {
                        span.setAttribute('llm.response', sanitizer.sanitize(choices[0].message.content));
                    }
                    // Anthropic format
                    const content = responseBody.content as Array<{ text?: string }> | undefined;
                    if (content?.[0]?.text && sanitizer) {
                        span.setAttribute('llm.response', sanitizer.sanitize(content[0].text));
                    }
                } catch {
                    // Response body parsing failure is non-fatal
                }
            }

            tracer.endSpan(span);
            return response;
        } catch (error) {
            const latencyMs = nowMs() - startTime;
            span.setAttribute('llm.latency_ms', Math.round(latencyMs));

            if (error instanceof Error) {
                span.recordException(error);
            } else {
                span.setStatus('ERROR', String(error));
            }

            tracer.endSpan(span);
            throw error; // Always re-throw
        }
    };

    installed = true;
    return uninstallFetchInterceptor;
}

/**
 * Uninstall the fetch interceptor and restore original fetch.
 */
export function uninstallFetchInterceptor(): void {
    if (originalFetch) {
        globalThis.fetch = originalFetch;
        originalFetch = null;
    }
    installed = false;
    additionalPatterns = [];
}
