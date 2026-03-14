// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Enriched Log Builder
// ═══════════════════════════════════════════════════════════════════
// Aggregates raw LLMSpan data into the single structured JSON
// envelope that Grafana Loki and other exporters consume.

import type { LLMTelemetryConfig, OTLPSpan } from '../types';
import { computeCost } from '../cost/pricing';

// ─── Output Types ───────────────────────────────────────────────

export interface PipelineBlock {
    query: string;
    duration_ms: number;
    tool_iterations: number;
    events_returned: number;
    final_response: string;
}

export interface TokenIterationBlock {
    iteration: number;
    prompt: number;
    completion: number;
    model: string;
}

export interface TokensBlock {
    prompt: number;
    completion: number;
    total: number;
    by_iteration: TokenIterationBlock[];
}

export interface CostBlock {
    prompt_usd: number;
    completion_usd: number;
    total_usd: number;
    model: string;
    currency: 'USD';
}

export interface EvaluationScores {
    correctness?: number;
    hallucination?: number;
    relevance?: number;
    helpfulness?: number;
    coherence?: number;
    grounding?: number;
    overall?: number;
}

export interface HallucinationDetail {
    grounding_score?: number;
    claims_found?: number;
    claims_grounded?: number;
    ungrounded_phrases: string[];
}

export interface EvaluationBlock {
    enabled: boolean;
    triggered: boolean;
    async?: boolean;
    reason?: string;
    scores?: EvaluationScores;
    hallucination_detail?: HallucinationDetail;
    graded_by?: string;
    eval_latency_ms?: number;
    eval_cost_usd?: number;
}

export interface SpanSummary {
    name: string;
    span_id: string;
    parent_span_id?: string;
    duration_ms: number;
    attributes: Record<string, unknown>;
}

export interface EnrichedTraceLog {
    level: 'INFO' | 'WARN' | 'ERROR';
    event: 'llm_trace';
    schema_version: '1.1';
    timestamp: string;
    trace_id: string;
    session_id: string;
    user_id: string | null;
    platform: string;
    app_version: string;

    pipeline: PipelineBlock;
    tokens: TokensBlock;
    cost: CostBlock;
    evaluation: EvaluationBlock;
    spans: SpanSummary[];

    // ── Flattened keys for Loki LogQL unwrap ──
    tokens_total: number;
    tokens_prompt: number;
    tokens_completion: number;
    cost_total_usd: number;
    cost_prompt_usd: number;
    cost_completion_usd: number;
    evaluation_scores_correctness?: number;
    evaluation_scores_hallucination?: number;
    evaluation_scores_relevance?: number;
    evaluation_scores_coherence?: number;
    evaluation_scores_overall?: number;
    pipeline_duration_ms: number;
    pipeline_events_returned: number;
}

// ─── Helpers ────────────────────────────────────────────────────

function getStr(span: OTLPSpan, key: string): string | undefined {
    const attr = span.attributes.find((a) => a.key === key);
    return attr?.value?.stringValue;
}

function getNum(span: OTLPSpan, key: string): number | undefined {
    const attr = span.attributes.find((a) => a.key === key);
    if (attr?.value?.intValue) return parseInt(attr.value.intValue, 10);
    if (attr?.value?.doubleValue !== undefined) return attr.value.doubleValue;
    return undefined;
}

function spanDurationMs(span: OTLPSpan): number {
    const latency = getNum(span, 'llm.latency_ms');
    if (latency !== undefined) return latency;
    try {
        const startNs = BigInt(span.startTimeUnixNano);
        const endNs = BigInt(span.endTimeUnixNano);
        return Number((endNs - startNs) / BigInt(1_000_000));
    } catch {
        return 0;
    }
}

function attrsToRecord(span: OTLPSpan): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const attr of span.attributes) {
        if (attr.value.stringValue !== undefined) {
            result[attr.key] = attr.value.stringValue;
        } else if (attr.value.intValue !== undefined) {
            result[attr.key] = parseInt(attr.value.intValue, 10);
        } else if (attr.value.doubleValue !== undefined) {
            result[attr.key] = attr.value.doubleValue;
        } else if (attr.value.boolValue !== undefined) {
            result[attr.key] = attr.value.boolValue;
        }
    }
    return result;
}

// ─── Builder ────────────────────────────────────────────────────

/**
 * Build an enriched trace log from a batch of OTLP spans belonging
 * to the same trace. If spans come from multiple traces, the first
 * trace encountered is used as the primary.
 */
export function buildEnrichedLog(
    spans: OTLPSpan[],
    config?: Partial<LLMTelemetryConfig>,
): EnrichedTraceLog {
    if (spans.length === 0) {
        return emptyLog();
    }

    // ── Identify the primary span (root / API call) ──
    const primary = spans.find((s) =>
        s.name === 'llm.api_call' ||
        s.name === 'llm.chat_completion' ||
        s.name === 'rag.pipeline' ||
        !s.parentSpanId
    ) ?? spans[0];

    const evalSpan = spans.find((s) => s.name === 'llm.evaluation');

    // ── Pipeline block ──
    const query = getStr(primary, 'rag.query')
        || getStr(primary, 'llm.prompt')
        || '';
    const finalResponse = getStr(primary, 'llm.response') || '';
    const eventsReturned = getNum(primary, 'rag.documents_retrieved') ?? 0;
    const durationMs = spanDurationMs(primary);

    // Count LLM completion child spans as iterations
    const completionSpans = spans.filter((s) =>
        s.name === 'llm.completion' ||
        (s.parentSpanId && s.name.includes('completion'))
    );
    const toolIterations = completionSpans.length || 1;

    const pipeline: PipelineBlock = {
        query,
        duration_ms: durationMs,
        tool_iterations: toolIterations,
        events_returned: eventsReturned,
        final_response: finalResponse.substring(0, 500),
    };

    // ── Tokens block ──
    let totalPrompt = 0;
    let totalCompletion = 0;
    const byIteration: TokenIterationBlock[] = [];

    if (completionSpans.length > 0) {
        completionSpans.forEach((s, idx) => {
            const pt = getNum(s, 'llm.prompt_tokens') ?? getNum(s, 'gen_ai.usage.input_tokens') ?? 0;
            const ct = getNum(s, 'llm.completion_tokens') ?? getNum(s, 'gen_ai.usage.output_tokens') ?? 0;
            totalPrompt += pt;
            totalCompletion += ct;
            byIteration.push({
                iteration: idx + 1,
                prompt: pt,
                completion: ct,
                model: getStr(s, 'llm.model') || 'unknown',
            });
        });
    } else {
        // Single-span trace — tokens on the primary span
        totalPrompt = getNum(primary, 'llm.prompt_tokens') ?? getNum(primary, 'gen_ai.usage.input_tokens') ?? 0;
        totalCompletion = getNum(primary, 'llm.completion_tokens') ?? getNum(primary, 'gen_ai.usage.output_tokens') ?? 0;
        if (totalPrompt > 0 || totalCompletion > 0) {
            byIteration.push({
                iteration: 1,
                prompt: totalPrompt,
                completion: totalCompletion,
                model: getStr(primary, 'llm.model') || 'unknown',
            });
        }
    }

    const tokens: TokensBlock = {
        prompt: totalPrompt,
        completion: totalCompletion,
        total: totalPrompt + totalCompletion,
        by_iteration: byIteration,
    };

    // ── Cost block ──
    const primaryModel = getStr(primary, 'llm.model') || 'unknown';
    const cost = computeCost(primaryModel, totalPrompt, totalCompletion);

    // ── Evaluation block ──
    const evaluationEnabled = config?.evaluationEnabled ?? false;
    let evaluation: EvaluationBlock;

    // Check for eval scores on the primary span or dedicated eval span
    const evalSource = evalSpan ?? primary;
    const correctness = getNum(evalSource, 'llm.eval.correctness');
    const hallucination = getNum(evalSource, 'llm.eval.hallucination');
    const relevance = getNum(evalSource, 'llm.eval.relevance');
    const helpfulness = getNum(evalSource, 'llm.eval.helpfulness');
    const coherence = getNum(evalSource, 'llm.eval.coherence');
    const grounding = getNum(evalSource, 'llm.eval.grounding');
    const hasEvalScores = correctness !== undefined || hallucination !== undefined;

    if (hasEvalScores) {
        const scoreValues = [correctness, hallucination, relevance, helpfulness, coherence, grounding]
            .filter((v): v is number => v !== undefined);
        const overall = scoreValues.length > 0
            ? Number((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(2))
            : undefined;

        evaluation = {
            enabled: true,
            triggered: true,
            async: false,
            scores: {
                correctness,
                hallucination,
                relevance,
                helpfulness,
                coherence,
                grounding,
                overall,
            },
            graded_by: getStr(evalSource, 'llm.eval.grader_model') || config?.evaluationModel || 'gpt-4o-mini',
        };
    } else {
        const reasons: string[] = [];
        if (!evaluationEnabled) reasons.push('evaluationEnabled=false');
        if (!finalResponse) reasons.push('missing llm.response');
        if (!query) reasons.push('missing rag.query');

        evaluation = {
            enabled: evaluationEnabled,
            triggered: false,
            reason: reasons.join(' | ') || 'no evaluation data',
        };
    }

    // ── Spans summary ──
    const spanSummaries: SpanSummary[] = spans.map((s) => ({
        name: s.name,
        span_id: s.spanId,
        parent_span_id: s.parentSpanId,
        duration_ms: spanDurationMs(s),
        attributes: attrsToRecord(s),
    }));

    // ── Metadata ──
    const sessionId = getStr(primary, 'session.id') || '';
    const platform = getStr(primary, 'mobile.platform') || 'unknown';
    const appVersion = getStr(primary, 'mobile.app_version') || 'unknown';
    const hasError = spans.some((s) => s.status.code === 2);

    return {
        level: hasError ? 'ERROR' : 'INFO',
        event: 'llm_trace',
        schema_version: '1.1',
        timestamp: new Date().toISOString(),
        trace_id: primary.traceId,
        session_id: sessionId,
        user_id: null,
        platform,
        app_version: appVersion,

        pipeline,
        tokens,
        cost,
        evaluation,
        spans: spanSummaries,

        // Flattened for Loki LogQL unwrap
        tokens_total: tokens.total,
        tokens_prompt: tokens.prompt,
        tokens_completion: tokens.completion,
        cost_total_usd: cost.total_usd,
        cost_prompt_usd: cost.prompt_usd,
        cost_completion_usd: cost.completion_usd,
        evaluation_scores_correctness: correctness,
        evaluation_scores_hallucination: hallucination,
        evaluation_scores_relevance: relevance,
        evaluation_scores_coherence: coherence,
        evaluation_scores_overall: evaluation.scores?.overall,
        pipeline_duration_ms: durationMs,
        pipeline_events_returned: eventsReturned,
    };
}

function emptyLog(): EnrichedTraceLog {
    return {
        level: 'WARN',
        event: 'llm_trace',
        schema_version: '1.1',
        timestamp: new Date().toISOString(),
        trace_id: '',
        session_id: '',
        user_id: null,
        platform: 'unknown',
        app_version: 'unknown',
        pipeline: { query: '', duration_ms: 0, tool_iterations: 0, events_returned: 0, final_response: '' },
        tokens: { prompt: 0, completion: 0, total: 0, by_iteration: [] },
        cost: { prompt_usd: 0, completion_usd: 0, total_usd: 0, model: 'unknown', currency: 'USD' },
        evaluation: { enabled: false, triggered: false, reason: 'empty span batch' },
        spans: [],
        tokens_total: 0,
        tokens_prompt: 0,
        tokens_completion: 0,
        cost_total_usd: 0,
        cost_prompt_usd: 0,
        cost_completion_usd: 0,
        pipeline_duration_ms: 0,
        pipeline_events_returned: 0,
    };
}
