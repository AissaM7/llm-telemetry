// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Semantic Attribute Constants
// ═══════════════════════════════════════════════════════════════════
// Following OpenTelemetry GenAI semantic conventions where they exist.
// https://opentelemetry.io/docs/specs/semconv/gen-ai/

export const SemanticAttributes = {
    // OpenTelemetry GenAI conventions
    GEN_AI_SYSTEM: 'gen_ai.system',
    GEN_AI_REQUEST_MODEL: 'gen_ai.request.model',
    GEN_AI_REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
    GEN_AI_REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
    GEN_AI_RESPONSE_MODEL: 'gen_ai.response.model',
    GEN_AI_RESPONSE_FINISH_REASONS: 'gen_ai.response.finish_reasons',
    GEN_AI_USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
    GEN_AI_USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',

    // Extended LLM attributes
    LLM_PROVIDER: 'llm.provider',
    LLM_LATENCY_MS: 'llm.latency_ms',
    LLM_TTFB_MS: 'llm.ttfb_ms',
    LLM_STREAMING: 'llm.streaming',
    LLM_REQUEST_ID: 'llm.request_id',
    LLM_PROMPT_SANITIZED: 'llm.prompt.sanitized',
    LLM_RESPONSE_SANITIZED: 'llm.response.sanitized',
    LLM_SYSTEM_PROMPT_HASH: 'llm.system_prompt_hash',
    LLM_TOOL_CALLS: 'llm.tool_calls',
    LLM_TOOL_CALL_COUNT: 'llm.tool_call_count',

    // Evaluation scores
    LLM_EVAL_CORRECTNESS: 'llm.eval.correctness',
    LLM_EVAL_HALLUCINATION: 'llm.eval.hallucination',
    LLM_EVAL_RELEVANCE: 'llm.eval.relevance',
    LLM_EVAL_HELPFULNESS: 'llm.eval.helpfulness',
    LLM_EVAL_COHERENCE: 'llm.eval.coherence',
    LLM_EVAL_GROUNDING: 'llm.eval.grounding',
    LLM_EVAL_REASONING: 'llm.eval.reasoning',

    // RAG pipeline
    RAG_QUERY: 'rag.query',
    RAG_EMBEDDING_MODEL: 'rag.embedding_model',
    RAG_EMBEDDING_LATENCY_MS: 'rag.embedding_latency_ms',
    RAG_VECTOR_SEARCH_LATENCY_MS: 'rag.vector_search_latency_ms',
    RAG_DOCUMENTS_RETRIEVED: 'rag.documents_retrieved',
    RAG_SEARCH_STRATEGY: 'rag.search_strategy',
    RAG_SIMILARITY_THRESHOLD: 'rag.similarity_threshold',
    RAG_CONTEXT_LENGTH: 'rag.context_length_chars',

    // Mobile context
    MOBILE_PLATFORM: 'mobile.platform',
    MOBILE_OS_VERSION: 'mobile.os_version',
    MOBILE_APP_VERSION: 'mobile.app_version',
    MOBILE_DEVICE_MODEL: 'mobile.device_model',

    // Session
    SESSION_ID: 'session.id',
    SESSION_MESSAGE_COUNT: 'session.message_count',

    // Error tracking
    ERROR_TYPE: 'error.type',
    ERROR_MESSAGE: 'error.message',
    ERROR_STATUS_CODE: 'error.status_code',
} as const;

// Individual named exports for tree-shaking
export const GEN_AI_SYSTEM = SemanticAttributes.GEN_AI_SYSTEM;
export const GEN_AI_REQUEST_MODEL = SemanticAttributes.GEN_AI_REQUEST_MODEL;
export const GEN_AI_REQUEST_MAX_TOKENS = SemanticAttributes.GEN_AI_REQUEST_MAX_TOKENS;
export const GEN_AI_REQUEST_TEMPERATURE = SemanticAttributes.GEN_AI_REQUEST_TEMPERATURE;
export const GEN_AI_RESPONSE_MODEL = SemanticAttributes.GEN_AI_RESPONSE_MODEL;
export const GEN_AI_RESPONSE_FINISH_REASONS = SemanticAttributes.GEN_AI_RESPONSE_FINISH_REASONS;
export const GEN_AI_USAGE_INPUT_TOKENS = SemanticAttributes.GEN_AI_USAGE_INPUT_TOKENS;
export const GEN_AI_USAGE_OUTPUT_TOKENS = SemanticAttributes.GEN_AI_USAGE_OUTPUT_TOKENS;
export const LLM_PROVIDER = SemanticAttributes.LLM_PROVIDER;
export const LLM_LATENCY_MS = SemanticAttributes.LLM_LATENCY_MS;
export const LLM_TTFB_MS = SemanticAttributes.LLM_TTFB_MS;
export const LLM_STREAMING = SemanticAttributes.LLM_STREAMING;
export const LLM_REQUEST_ID = SemanticAttributes.LLM_REQUEST_ID;
export const LLM_PROMPT_SANITIZED = SemanticAttributes.LLM_PROMPT_SANITIZED;
export const LLM_RESPONSE_SANITIZED = SemanticAttributes.LLM_RESPONSE_SANITIZED;
export const LLM_SYSTEM_PROMPT_HASH = SemanticAttributes.LLM_SYSTEM_PROMPT_HASH;
export const LLM_TOOL_CALLS = SemanticAttributes.LLM_TOOL_CALLS;
export const LLM_TOOL_CALL_COUNT = SemanticAttributes.LLM_TOOL_CALL_COUNT;
export const LLM_EVAL_CORRECTNESS = SemanticAttributes.LLM_EVAL_CORRECTNESS;
export const LLM_EVAL_HALLUCINATION = SemanticAttributes.LLM_EVAL_HALLUCINATION;
export const LLM_EVAL_RELEVANCE = SemanticAttributes.LLM_EVAL_RELEVANCE;
export const LLM_EVAL_HELPFULNESS = SemanticAttributes.LLM_EVAL_HELPFULNESS;
export const LLM_EVAL_COHERENCE = SemanticAttributes.LLM_EVAL_COHERENCE;
export const LLM_EVAL_GROUNDING = SemanticAttributes.LLM_EVAL_GROUNDING;
export const LLM_EVAL_REASONING = SemanticAttributes.LLM_EVAL_REASONING;
export const RAG_QUERY = SemanticAttributes.RAG_QUERY;
export const RAG_EMBEDDING_MODEL = SemanticAttributes.RAG_EMBEDDING_MODEL;
export const RAG_EMBEDDING_LATENCY_MS = SemanticAttributes.RAG_EMBEDDING_LATENCY_MS;
export const RAG_VECTOR_SEARCH_LATENCY_MS = SemanticAttributes.RAG_VECTOR_SEARCH_LATENCY_MS;
export const RAG_DOCUMENTS_RETRIEVED = SemanticAttributes.RAG_DOCUMENTS_RETRIEVED;
export const RAG_SEARCH_STRATEGY = SemanticAttributes.RAG_SEARCH_STRATEGY;
export const RAG_SIMILARITY_THRESHOLD = SemanticAttributes.RAG_SIMILARITY_THRESHOLD;
export const RAG_CONTEXT_LENGTH = SemanticAttributes.RAG_CONTEXT_LENGTH;
export const MOBILE_PLATFORM = SemanticAttributes.MOBILE_PLATFORM;
export const MOBILE_OS_VERSION = SemanticAttributes.MOBILE_OS_VERSION;
export const MOBILE_APP_VERSION = SemanticAttributes.MOBILE_APP_VERSION;
export const MOBILE_DEVICE_MODEL = SemanticAttributes.MOBILE_DEVICE_MODEL;
export const SESSION_ID = SemanticAttributes.SESSION_ID;
export const SESSION_MESSAGE_COUNT = SemanticAttributes.SESSION_MESSAGE_COUNT;
export const ERROR_TYPE = SemanticAttributes.ERROR_TYPE;
export const ERROR_MESSAGE = SemanticAttributes.ERROR_MESSAGE;
export const ERROR_STATUS_CODE = SemanticAttributes.ERROR_STATUS_CODE;

export type SemanticAttributeKey = typeof SemanticAttributes[keyof typeof SemanticAttributes];
