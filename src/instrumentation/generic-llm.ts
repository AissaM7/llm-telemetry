// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Generic LLM Wrapper
// ═══════════════════════════════════════════════════════════════════
// Universal wrapper for ANY LLM or custom AI function.

import { LLMTracer } from '../core/tracer';
import { nowMs } from '../core/clock';
import type { TraceLLMOptions } from '../types';

/**
 * Instrument any LLM call with a simple wrapper function.
 * Provider-agnostic — works with any async function.
 *
 * @example
 * const response = await traceLLM({
 *   fn: () => callMyLLM(prompt),
 *   model: 'gpt-4o',
 *   provider: 'openai',
 *   extractResponse: (r) => r.text,
 *   extractTokens: (r) => ({
 *     promptTokens: r.usage.input,
 *     completionTokens: r.usage.output
 *   }),
 * });
 */
export async function traceLLM<TResponse>(
    options: TraceLLMOptions<TResponse>
): Promise<TResponse> {
    const tracer = LLMTracer.getInstance();

    if (!tracer.isInitialized()) {
        return options.fn();
    }

    const span = tracer.startSpan('llm.completion', {
        traceId: options.parentTraceId,
        attributes: {
            'llm.model': options.model,
            'llm.provider': options.provider ?? 'custom',
            'llm.streaming': false,
        } as Record<string, string | boolean>,
    });

    const sanitizer = tracer.getSanitizer();

    if (options.temperature !== undefined) span.setAttribute('llm.temperature', options.temperature);
    if (options.maxTokens !== undefined) span.setAttribute('llm.max_tokens', options.maxTokens);
    if (options.systemPrompt && sanitizer) {
        span.setAttribute('llm.system_prompt_hash', sanitizer.hashString(options.systemPrompt));
    }
    if (options.messages?.length && sanitizer) {
        const last = [...options.messages].reverse().find((m) => m.role === 'user');
        if (last?.content) span.setAttribute('llm.prompt', sanitizer.sanitize(last.content));
    }
    if (options.ragContext) {
        span.setAttribute('rag.query', options.ragContext.query);
        if (options.ragContext.documents) {
            span.setAttribute('rag.documents_retrieved', options.ragContext.documents.length);
            // Serialize documents for the hallucination scorer
            try {
                const docStrings = options.ragContext.documents.map((d: unknown) =>
                    typeof d === 'string' ? d : JSON.stringify(d)
                );
                span.setAttribute('rag.documents', JSON.stringify(docStrings));
            } catch { /* non-fatal */ }
        }
        if (options.ragContext.embeddingLatencyMs !== undefined) span.setAttribute('rag.embedding_latency_ms', options.ragContext.embeddingLatencyMs);
        if (options.ragContext.searchLatencyMs !== undefined) span.setAttribute('rag.vector_search_latency_ms', options.ragContext.searchLatencyMs);
        if (options.ragContext.searchStrategy) span.setAttribute('rag.search_strategy', options.ragContext.searchStrategy);
    }

    const startTime = nowMs();

    try {
        // Signal to the fetch interceptor that a manual trace is in progress.
        // Any fetch() call inside fn() should NOT create a separate span.
        tracer.enterManualTrace();
        let response: TResponse;
        try {
            response = await options.fn();
        } finally {
            tracer.exitManualTrace();
        }
        const latencyMs = nowMs() - startTime;
        span.setAttribute('llm.latency_ms', Math.round(latencyMs));

        if (options.extractTokens) {
            try {
                const tokens = options.extractTokens(response);
                if (tokens.promptTokens !== undefined) span.setAttribute('llm.prompt_tokens', tokens.promptTokens);
                if (tokens.completionTokens !== undefined) span.setAttribute('llm.completion_tokens', tokens.completionTokens);
                const total = (tokens.promptTokens ?? 0) + (tokens.completionTokens ?? 0);
                if (total > 0) span.setAttribute('llm.total_tokens', total);
            } catch { /* non-fatal */ }
        }

        if (options.extractResponse) {
            try {
                const text = options.extractResponse(response);
                if (text) {
                    span.setAttribute('llm.response', sanitizer ? sanitizer.sanitize(text) : text);
                }
            } catch { /* non-fatal */ }
        }

        if (options.extractToolCalls) {
            try {
                const names = options.extractToolCalls(response);
                if (names?.length) {
                    span.setAttribute('llm.tool_calls', JSON.stringify(names));
                    span.setAttribute('llm.tool_call_count', names.length);
                }
            } catch { /* non-fatal */ }
        }

        if (options.extractRequestId) {
            try {
                const id = options.extractRequestId(response);
                if (id) span.setAttribute('llm.request_id', id);
            } catch { /* non-fatal */ }
        }

        if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.log('[EvalDebug] pre-endSpan attrs:', {
                'llm.response': !!span.getAttribute('llm.response'),
                'rag.query': !!span.getAttribute('rag.query'),
                'llm.prompt': !!span.getAttribute('llm.prompt'),
                model: options.model,
            });
        }

        span.setStatus('OK');
        tracer.endSpan(span);
        return response;
    } catch (error) {
        span.setAttribute('llm.latency_ms', Math.round(nowMs() - startTime));
        if (error instanceof Error) span.recordException(error);
        else span.setStatus('ERROR', String(error));
        tracer.endSpan(span);
        throw error;
    }
}
