// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — RAG Attribute Builders
// ═══════════════════════════════════════════════════════════════════

import type { LLMSpanAttributes } from '../types';

/**
 * Build RAG pipeline span attributes from retrieval parameters.
 */
export function buildRAGAttributes(params: {
    query: string;
    embeddingModel?: string;
    embeddingLatencyMs?: number;
    vectorSearchLatencyMs?: number;
    documentsRetrieved?: number;
    searchStrategy?: 'vector' | 'keyword' | 'hybrid' | string;
    similarityThreshold?: number;
    contextLengthChars?: number;
}): Partial<LLMSpanAttributes> {
    const attrs: Partial<LLMSpanAttributes> = {};

    if (params.query) attrs['rag.query'] = params.query;
    if (params.embeddingModel) attrs['rag.embedding_model'] = params.embeddingModel;
    if (params.embeddingLatencyMs !== undefined) attrs['rag.embedding_latency_ms'] = params.embeddingLatencyMs;
    if (params.vectorSearchLatencyMs !== undefined) attrs['rag.vector_search_latency_ms'] = params.vectorSearchLatencyMs;
    if (params.documentsRetrieved !== undefined) attrs['rag.documents_retrieved'] = params.documentsRetrieved;
    if (params.searchStrategy) attrs['rag.search_strategy'] = params.searchStrategy;
    if (params.similarityThreshold !== undefined) attrs['rag.similarity_threshold'] = params.similarityThreshold;
    if (params.contextLengthChars !== undefined) attrs['rag.context_length_chars'] = params.contextLengthChars;

    return attrs;
}

/**
 * Build RAG embedding stage attributes.
 */
export function buildEmbeddingAttributes(params: {
    model?: string;
    inputLength?: number;
    latencyMs: number;
}): Record<string, string | number> {
    const attrs: Record<string, string | number> = {
        'rag.embedding_latency_ms': params.latencyMs,
    };
    if (params.model) attrs['rag.embedding_model'] = params.model;
    if (params.inputLength !== undefined) attrs['rag.embedding_input_length'] = params.inputLength;
    return attrs;
}

/**
 * Build RAG vector search stage attributes.
 */
export function buildVectorSearchAttributes(params: {
    table?: string;
    strategy?: 'vector' | 'keyword' | 'hybrid';
    threshold?: number;
    latencyMs: number;
    documentsRetrieved?: number;
}): Record<string, string | number> {
    const attrs: Record<string, string | number> = {
        'rag.vector_search_latency_ms': params.latencyMs,
    };
    if (params.table) attrs['rag.search_table'] = params.table;
    if (params.strategy) attrs['rag.search_strategy'] = params.strategy;
    if (params.threshold !== undefined) attrs['rag.similarity_threshold'] = params.threshold;
    if (params.documentsRetrieved !== undefined) attrs['rag.documents_retrieved'] = params.documentsRetrieved;
    return attrs;
}
