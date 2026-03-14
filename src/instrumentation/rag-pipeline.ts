// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — RAG Pipeline Tracing
// ═══════════════════════════════════════════════════════════════════

import { LLMTracer } from '../core/tracer';
import { LLMSpan } from '../core/span';
import { nowMs } from '../core/clock';
import { buildTraceparent } from '../core/context';
import { generateTraceId } from '../core/id';
import type { RAGPipelineOptions } from '../types';

/**
 * Traces a complete RAG pipeline with child spans for each stage:
 * embedding → vector search → context build → LLM completion.
 *
 * @example
 * const pipeline = new RAGPipeline({ query: 'events this weekend' });
 * const embedding = await pipeline.traceEmbedding(() => embed(query));
 * const results = await pipeline.traceVectorSearch(() => search(embedding));
 * const { contextString } = pipeline.traceContextBuild(results);
 * const answer = await pipeline.traceLLMCompletion(() => llm(contextString));
 * pipeline.end();
 */
export class RAGPipeline {
    private tracer: LLMTracer;
    private rootSpan: LLMSpan;
    private traceId: string;

    constructor(options: RAGPipelineOptions) {
        this.tracer = LLMTracer.getInstance();
        this.traceId = options.traceId ?? generateTraceId();

        this.rootSpan = this.tracer.startSpan('rag.pipeline', {
            traceId: this.traceId,
            attributes: {
                'rag.query': options.query,
                'rag.search_strategy': options.searchStrategy ?? 'hybrid',
            } as Record<string, string>,
        });
    }

    /**
     * Trace the embedding generation stage.
     */
    async traceEmbedding<T>(
        fn: () => Promise<T>,
        meta?: { model?: string; inputLength?: number }
    ): Promise<T> {
        const span = this.tracer.startSpan('rag.embedding', {
            traceId: this.traceId,
            parentSpanId: this.rootSpan.spanId,
        });

        if (meta?.model) span.setAttribute('rag.embedding_model', meta.model);
        if (meta?.inputLength) span.setAttribute('rag.embedding_input_length', meta.inputLength);

        const start = nowMs();
        try {
            const result = await fn();
            const latency = Math.round(nowMs() - start);
            span.setAttribute('rag.embedding_latency_ms', latency);
            span.setStatus('OK');
            this.tracer.endSpan(span);
            return result;
        } catch (error) {
            span.setAttribute('rag.embedding_latency_ms', Math.round(nowMs() - start));
            if (error instanceof Error) span.recordException(error);
            this.tracer.endSpan(span);
            throw error;
        }
    }

    /**
     * Trace the vector search stage.
     */
    async traceVectorSearch<T>(
        fn: () => Promise<T>,
        meta?: { table?: string; strategy?: 'vector' | 'keyword' | 'hybrid'; threshold?: number }
    ): Promise<T> {
        const span = this.tracer.startSpan('rag.vector_search', {
            traceId: this.traceId,
            parentSpanId: this.rootSpan.spanId,
        });

        if (meta?.table) span.setAttribute('rag.search_table', meta.table);
        if (meta?.strategy) span.setAttribute('rag.search_strategy', meta.strategy);
        if (meta?.threshold !== undefined) span.setAttribute('rag.similarity_threshold', meta.threshold);

        const start = nowMs();
        try {
            const result = await fn();
            const latency = Math.round(nowMs() - start);
            span.setAttribute('rag.vector_search_latency_ms', latency);

            if (Array.isArray(result)) {
                span.setAttribute('rag.documents_retrieved', result.length);
            }

            span.setStatus('OK');
            this.tracer.endSpan(span);
            return result;
        } catch (error) {
            span.setAttribute('rag.vector_search_latency_ms', Math.round(nowMs() - start));
            if (error instanceof Error) span.recordException(error);
            this.tracer.endSpan(span);
            throw error;
        }
    }

    /**
     * Trace the context building stage (synchronous).
     */
    traceContextBuild(documents: unknown[]): { contextString: string; documentCount: number } {
        const span = this.tracer.startSpan('rag.context_build', {
            traceId: this.traceId,
            parentSpanId: this.rootSpan.spanId,
        });

        const docStrings = documents.map((doc, i) => {
            if (typeof doc === 'string') return `[${i + 1}] ${doc}`;
            if (doc && typeof doc === 'object' && 'content' in doc) {
                return `[${i + 1}] ${String((doc as { content: unknown }).content)}`;
            }
            return `[${i + 1}] ${JSON.stringify(doc)}`;
        });

        const contextString = docStrings.join('\n\n');

        span.setAttribute('rag.documents_retrieved', documents.length);
        span.setAttribute('rag.context_length_chars', contextString.length);
        span.setStatus('OK');
        this.tracer.endSpan(span);

        return { contextString, documentCount: documents.length };
    }

    /**
     * Trace the LLM completion stage.
     */
    async traceLLMCompletion<T>(fn: () => Promise<T>): Promise<T> {
        const span = this.tracer.startSpan('llm.completion', {
            traceId: this.traceId,
            parentSpanId: this.rootSpan.spanId,
        });

        const start = nowMs();
        try {
            const result = await fn();
            span.setAttribute('llm.latency_ms', Math.round(nowMs() - start));
            span.setStatus('OK');
            this.tracer.endSpan(span);
            return result;
        } catch (error) {
            span.setAttribute('llm.latency_ms', Math.round(nowMs() - start));
            if (error instanceof Error) span.recordException(error);
            this.tracer.endSpan(span);
            throw error;
        }
    }

    /**
     * End the root pipeline span with optional final attributes.
     */
    end(meta?: Record<string, string | number | boolean>): void {
        if (meta) {
            for (const [key, value] of Object.entries(meta)) {
                this.rootSpan.setAttribute(key, value);
            }
        }
        this.tracer.endSpan(this.rootSpan);
    }

    getTraceId(): string { return this.traceId; }
    getTraceparent(): string { return buildTraceparent(this.traceId, this.rootSpan.spanId, true); }
}
