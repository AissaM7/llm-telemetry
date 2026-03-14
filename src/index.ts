// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Public API
// ═══════════════════════════════════════════════════════════════════
// Clean barrel export for developers.

// Primary setup
export { LLMTracer } from './core/tracer';

// Core instrumentation
export { traceLLM } from './instrumentation/generic-llm';
export { instrumentOpenAI } from './instrumentation/openai';
export { instrumentAnthropic } from './instrumentation/anthropic';
export { installFetchInterceptor } from './instrumentation/fetch-interceptor';
export { RAGPipeline } from './instrumentation/rag-pipeline';

// Evaluation
export { ResponseEvaluator } from './evaluation/evaluator';

// Cost
export { computeCost } from './cost/pricing';

// Enriched log
export { buildEnrichedLog } from './export/enriched-log';

// Types
export type {
    LLMTelemetryConfig,
    LLMSpanAttributes,
    TraceHandle,
    EvaluationParams,
    EvaluationResult,
    RAGPipelineOptions,
    TraceLLMOptions,
    AttributeValue,
    ExportResult,
    IExporter,
    EnrichedTraceLog,
    CostBlock,
    TokensBlock,
    PipelineBlock,
    EvaluationBlock,
} from './types';
export type { CostResult } from './cost/pricing';

// Semantic attributes
export { SemanticAttributes } from './attributes/semantic';

// Grafana dashboard — one-click import
// Usage: import { GRAFANA_DASHBOARD } from '@llm-telemetry/react-native';
// Then POST to /api/dashboards/db or use Grafana provisioning.
export { default as GRAFANA_DASHBOARD } from '../grafana/dashboard.json';

// Core classes (advanced usage)
export { LLMSpan } from './core/span';
export { BatchProcessor } from './export/batch-processor';

import type { LLMTelemetryConfig } from './types';
import { LLMTracer } from './core/tracer';
import { traceLLM } from './instrumentation/generic-llm';
import { RAGPipeline } from './instrumentation/rag-pipeline';
import { installFetchInterceptor } from './instrumentation/fetch-interceptor';

/**
 * One-liner setup. Call once at app startup to configure everything.
 *
 * @example
 * const { tracer } = await initTelemetry({
 *   exporterType: 'otlp-http',
 *   collectorUrl: 'http://tempo:4318',
 *   evaluationApiKey: 'sk-...',
 * });
 */
export async function initTelemetry(config: LLMTelemetryConfig): Promise<{
    tracer: LLMTracer;
    traceLLM: typeof traceLLM;
    RAGPipeline: typeof RAGPipeline;
    installFetchInterceptor: typeof installFetchInterceptor;
}> {
    const tracer = LLMTracer.getInstance();
    await tracer.init(config);

    return {
        tracer,
        traceLLM,
        RAGPipeline,
        installFetchInterceptor,
    };
}
