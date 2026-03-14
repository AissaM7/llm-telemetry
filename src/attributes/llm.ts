// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — LLM Attribute Builders
// ═══════════════════════════════════════════════════════════════════

import { SemanticAttributes } from './semantic';
import type { LLMSpanAttributes } from '../types';

/**
 * Build LLM-specific span attributes from common parameters.
 */
export function buildLLMAttributes(params: {
    model: string;
    provider: string;
    latencyMs: number;
    streaming?: boolean;
    temperature?: number;
    maxTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    finishReason?: string;
    requestId?: string;
    ttfbMs?: number;
}): Partial<LLMSpanAttributes> {
    const attrs: Partial<LLMSpanAttributes> = {
        'llm.model': params.model,
        'llm.provider': params.provider,
        'llm.latency_ms': params.latencyMs,
        'llm.streaming': params.streaming ?? false,
    };

    if (params.temperature !== undefined) attrs['llm.temperature'] = params.temperature;
    if (params.maxTokens !== undefined) attrs['llm.max_tokens'] = params.maxTokens;
    if (params.promptTokens !== undefined) attrs['llm.prompt_tokens'] = params.promptTokens;
    if (params.completionTokens !== undefined) attrs['llm.completion_tokens'] = params.completionTokens;
    if (params.totalTokens !== undefined) attrs['llm.total_tokens'] = params.totalTokens;
    if (params.finishReason) attrs['llm.finish_reason'] = params.finishReason;
    if (params.requestId) attrs['llm.request_id'] = params.requestId;
    if (params.ttfbMs !== undefined) attrs['llm.ttfb_ms'] = params.ttfbMs;

    return attrs;
}

/**
 * Build GenAI semantic convention attributes (for standard OTel compatibility).
 */
export function buildGenAIAttributes(params: {
    system: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    finishReasons?: string[];
}): Record<string, string | number | string[]> {
    const attrs: Record<string, string | number | string[]> = {
        [SemanticAttributes.GEN_AI_SYSTEM]: params.system,
        [SemanticAttributes.GEN_AI_REQUEST_MODEL]: params.model,
    };

    if (params.temperature !== undefined) {
        attrs[SemanticAttributes.GEN_AI_REQUEST_TEMPERATURE] = params.temperature;
    }
    if (params.maxTokens !== undefined) {
        attrs[SemanticAttributes.GEN_AI_REQUEST_MAX_TOKENS] = params.maxTokens;
    }
    if (params.inputTokens !== undefined) {
        attrs[SemanticAttributes.GEN_AI_USAGE_INPUT_TOKENS] = params.inputTokens;
    }
    if (params.outputTokens !== undefined) {
        attrs[SemanticAttributes.GEN_AI_USAGE_OUTPUT_TOKENS] = params.outputTokens;
    }
    if (params.finishReasons) {
        attrs[SemanticAttributes.GEN_AI_RESPONSE_FINISH_REASONS] = params.finishReasons;
    }

    return attrs;
}

/**
 * Build tool call attributes from a list of tool call names.
 */
export function buildToolCallAttributes(
    toolCalls: Array<{ name: string;[key: string]: unknown }>
): { toolCallsJson: string; toolCallCount: number } {
    const names = toolCalls.map((tc) => tc.name);
    return {
        toolCallsJson: JSON.stringify(names),
        toolCallCount: toolCalls.length,
    };
}
