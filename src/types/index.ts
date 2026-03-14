// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Type Definitions
// ═══════════════════════════════════════════════════════════════════

// ─── Configuration ──────────────────────────────────────────────

export interface LLMTelemetryConfig {
    /** Exporter backend type */
    exporterType: 'otlp-http' | 'otlp-grpc' | 'datadog' | 'honeycomb' | 'loki' | 'supabase' | 'console' | 'multi';
    /** OTLP collector endpoint, e.g. http://tempo:4318. Required for otlp-http, otlp-grpc, datadog, honeycomb, supabase. */
    collectorUrl?: string;

    // Identity
    /** Service name for resource attributes. Default: 'llm-app' */
    serviceName?: string;
    /** Service version. Default: '1.0.0' */
    serviceVersion?: string;
    /** Application identifier */
    appId?: string;
    /** Deployment environment */
    environment?: 'production' | 'staging' | 'development' | string;

    // Auth
    /** API key for Honeycomb / Datadog / custom */
    apiKey?: string;
    /** Custom headers for exporter requests */
    headers?: Record<string, string>;

    // Behavior
    /** Enable/disable telemetry. Default: true */
    enabled?: boolean;
    /** Sampling rate 0.0-1.0. Default: 1.0 */
    sampleRate?: number;
    /** Number of spans per batch. Default: 10 */
    batchSize?: number;
    /** Flush interval in milliseconds. Default: 30000 */
    flushIntervalMs?: number;
    /** Maximum spans in queue. Default: 100 */
    maxQueueSize?: number;

    // Evaluation
    /** Enable automated evaluation scoring. Default: true */
    evaluationEnabled?: boolean;
    /** Model to use for LLM-as-judge grading. Default: 'gpt-4o' */
    evaluationModel?: string;
    /** OpenAI-compatible API key for grader */
    evaluationApiKey?: string;
    /** Custom evaluation endpoint URL */
    evaluationEndpoint?: string;

    // Privacy
    /** Sanitize/truncate prompts before export. Default: true */
    sanitizePrompts?: boolean;
    /** Maximum prompt length in chars. Default: 500 */
    maxPromptLength?: number;
    /** Strip PII patterns from exported data. Default: true */
    stripPII?: boolean;

    // Loki
    /** Loki push API base URL */
    lokiUrl?: string;
    /** Additional Loki stream labels */
    lokiLabels?: Record<string, string>;

    // Advanced
    /** Attributes attached to every span automatically (e.g. { team: 'ml', customer_tier: 'pro' }) */
    globalAttributes?: Record<string, string | number | boolean>;
    /** Called when telemetry fails (export error, eval error, etc.). Receives error message and context. */
    onError?: (error: string, context: { phase: 'export' | 'evaluation' | 'session' | 'init'; retryable: boolean }) => void;
    /** When exporterType is 'multi', specify which backends to use. Default: ['console', 'loki'] */
    multiExporters?: Array<'console' | 'loki' | 'otlp-http' | 'supabase' | 'datadog' | 'honeycomb'>;
}

// ─── Attribute Value Types ──────────────────────────────────────

export type AttributeValue = string | number | boolean | string[] | number[] | boolean[];

// ─── Span Attributes ────────────────────────────────────────────

export interface LLMSpanAttributes {
    // LLM core
    'llm.model': string;
    'llm.provider': string;
    'llm.temperature'?: number;
    'llm.max_tokens'?: number;
    'llm.prompt_tokens'?: number;
    'llm.completion_tokens'?: number;
    'llm.total_tokens'?: number;
    'llm.latency_ms': number;
    'llm.ttfb_ms'?: number;
    'llm.streaming': boolean;
    'llm.finish_reason'?: string;
    'llm.request_id'?: string;

    // LLM content (sanitized)
    'llm.prompt'?: string;
    'llm.response'?: string;
    'llm.system_prompt_hash'?: string;

    // Tool calls
    'llm.tool_calls'?: string;
    'llm.tool_call_count'?: number;

    // Evaluation scores
    'llm.eval.correctness'?: number;
    'llm.eval.hallucination'?: number;
    'llm.eval.relevance'?: number;
    'llm.eval.helpfulness'?: number;
    'llm.eval.coherence'?: number;
    'llm.eval.grounding'?: number;
    'llm.eval.reasoning'?: string;

    // RAG
    'rag.query'?: string;
    'rag.embedding_model'?: string;
    'rag.embedding_latency_ms'?: number;
    'rag.vector_search_latency_ms'?: number;
    'rag.documents_retrieved'?: number;
    'rag.search_strategy'?: string;
    'rag.similarity_threshold'?: number;
    'rag.context_length_chars'?: number;

    // Mobile / session
    'mobile.platform': string;
    'mobile.os_version': string;
    'mobile.app_version': string;
    'mobile.device_model'?: string;
    'session.id': string;
    'session.message_count'?: number;

    // Error
    'error.type'?: string;
    'error.message'?: string;
    'error.status_code'?: number;
}

// ─── Trace Handle ───────────────────────────────────────────────

export interface TraceHandle {
    traceId: string;
    spanId: string;
    /** W3C traceparent header value */
    traceparent: string;
    startTime: number;
}

// ─── Evaluation ─────────────────────────────────────────────────

export interface EvaluationParams {
    query: string;
    response: string;
    retrievedDocuments?: string[];
    expectedAnswer?: string;
    model?: string;
}

export interface EvaluationResult {
    /** 0-1: did AI answer accurately? */
    correctness: number;
    /** 0-1: higher = more hallucinated */
    hallucination: number;
    /** 0-1: were results relevant? */
    relevance: number;
    /** 0-1: was response actionable? */
    helpfulness: number;
    /** 0-1: was response well-structured? */
    coherence: number;
    /** 0-1: was response grounded in retrieved docs? */
    grounding: number;
    /** Brief explanation from evaluator */
    reasoning: string;
    /** ISO timestamp of evaluation */
    gradedAt: string;
    /** Model used for grading */
    graderModel: string;
}

// ─── RAG ────────────────────────────────────────────────────────

export interface RAGPipelineOptions {
    traceId?: string;
    query: string;
    searchStrategy?: 'vector' | 'keyword' | 'hybrid';
}

// ─── Span Status & Kind ─────────────────────────────────────────

export enum SpanKind {
    INTERNAL = 0,
    SERVER = 1,
    CLIENT = 2,
    PRODUCER = 3,
    CONSUMER = 4,
}

export interface SpanStatus {
    code: SpanStatusCode;
    message?: string;
}

export enum SpanStatusCode {
    UNSET = 0,
    OK = 1,
    ERROR = 2,
}

// ─── Span Event ─────────────────────────────────────────────────

export interface SpanEvent {
    name: string;
    timeUnixNano: string;
    attributes: KeyValue[];
}

// ─── OTLP Payload Types ─────────────────────────────────────────

export interface KeyValue {
    key: string;
    value: AnyValue;
}

export interface AnyValue {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: { values: AnyValue[] };
}

export interface OTLPSpan {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: number;
    startTimeUnixNano: string;
    endTimeUnixNano: string;
    attributes: KeyValue[];
    status: { code: number; message?: string };
    events?: SpanEvent[];
}

export interface OTLPSpanPayload {
    resourceSpans: Array<{
        resource: { attributes: KeyValue[] };
        scopeSpans: Array<{
            scope: { name: string; version: string };
            spans: OTLPSpan[];
        }>;
    }>;
}

// ─── Loki Payload ───────────────────────────────────────────────

export interface LokiLogPayload {
    streams: Array<{
        stream: Record<string, string>;
        values: Array<[string, string]>;
    }>;
}

// ─── Exporter ───────────────────────────────────────────────────

export type ExportResult =
    | { success: true; itemsExported: number }
    | { success: false; error: string; retryable: boolean };

export interface IExporter {
    export(payload: OTLPSpanPayload): Promise<ExportResult>;
    shutdown(): Promise<void>;
}

// ─── Mobile System Info ─────────────────────────────────────────

export interface MobileSystemInfo {
    platform: string;
    osVersion: string;
    appVersion: string;
    deviceModel: string;
}

// ─── Session Storage ────────────────────────────────────────────

export interface SessionData {
    sessionId: string;
    startedAt: string;
    messageCount: number;
    lastActiveAt: string;
}

// ─── Generic Trace LLM Options ──────────────────────────────────

export interface TraceLLMOptions<TResponse> {
    /** The actual LLM call */
    fn: () => Promise<TResponse>;
    /** Model name */
    model: string;
    /** Provider name. Default: 'custom' */
    provider?: string;
    /** Messages array for context */
    messages?: Array<{ role: string; content: string }>;
    /** System prompt for hashing */
    systemPrompt?: string;
    /** Temperature setting */
    temperature?: number;
    /** Max tokens setting */
    maxTokens?: number;
    /** Extract token counts from response */
    extractTokens?: (response: TResponse) => {
        promptTokens?: number;
        completionTokens?: number;
    };
    /** Extract response text from response */
    extractResponse?: (response: TResponse) => string;
    /** Extract tool call names from response */
    extractToolCalls?: (response: TResponse) => string[];
    /** Extract request ID from response */
    extractRequestId?: (response: TResponse) => string;
    /** Parent trace ID for correlation */
    parentTraceId?: string;
    /** RAG context for evaluation */
    ragContext?: {
        query: string;
        documents?: string[];
        embeddingLatencyMs?: number;
        searchLatencyMs?: number;
        searchStrategy?: string;
    };
}

// ─── Enriched Log Types ─────────────────────────────────────────
// Re-exported from export/enriched-log.ts for convenience

export type {
    EnrichedTraceLog,
    PipelineBlock,
    TokensBlock,
    CostBlock,
    EvaluationBlock,
} from '../export/enriched-log';

// ─── Cost Types ─────────────────────────────────────────────────

export type { CostResult } from '../cost/pricing';

