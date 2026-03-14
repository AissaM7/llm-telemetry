// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Loki Log Exporter
// ═══════════════════════════════════════════════════════════════════
// Pushes enriched LLM trace logs to Grafana Loki.
// Format matches the exact Loki push API and the Grafana dashboard
// query expectations: {job="llm-telemetry"} | json | event=`llm_trace`

import type { IExporter, ExportResult, OTLPSpanPayload, LLMTelemetryConfig, OTLPSpan } from '../types';
import { computeCost } from '../cost/pricing';

const EXPORT_TIMEOUT_MS = 10_000;

/** Detect platform at module load — safe fallback for non-RN envs. */
let detectedPlatform = 'unknown';
try {
    const { Platform } = require('react-native') as { Platform: { OS: string } };
    detectedPlatform = Platform.OS ?? 'unknown';
} catch {
    // Non-RN environment (tests, Node) — keep 'unknown'
}

// ─── Helpers ────────────────────────────────────────────────────

function getAttr(span: OTLPSpan, key: string): string | number | boolean | undefined {
    const attr = span.attributes.find((a) => a.key === key);
    if (!attr) return undefined;
    if (attr.value.stringValue !== undefined) return attr.value.stringValue;
    if (attr.value.intValue !== undefined) return Number(attr.value.intValue);
    if (attr.value.doubleValue !== undefined) return attr.value.doubleValue;
    if (attr.value.boolValue !== undefined) return attr.value.boolValue;
    return undefined;
}

function getNumAttr(span: OTLPSpan, key: string, fallback = 0): number {
    const v = getAttr(span, key);
    return typeof v === 'number' ? v : fallback;
}

function getStrAttr(span: OTLPSpan, key: string, fallback = ''): string {
    const v = getAttr(span, key);
    return typeof v === 'string' ? v : fallback;
}

// ─── Payload Builder (exported for testing) ─────────────────────

export interface LokiPushPayload {
    streams: Array<{
        stream: Record<string, string>;
        values: Array<[string, string]>;
    }>;
}

/**
 * Build a Loki push payload from a set of OTLP spans belonging
 * to the same trace.
 */
export function buildLokiPayload(
    spans: OTLPSpan[],
    traceId: string,
    context: { platform: string; env: string; app: string }
): LokiPushPayload {
    // Find the rag.pipeline span (top-level pipeline span)
    const pipelineSpan = spans.find((s) => s.name === 'rag.pipeline');

    // Find llm.completion spans
    const completionSpans = spans.filter((s) => s.name === 'llm.completion');

    // Extract model from the first completion span that has it,
    // or fall back to any span with llm.model
    let model = 'unknown';
    for (const s of completionSpans) {
        const m = getStrAttr(s, 'llm.model');
        if (m) { model = m; break; }
    }
    if (model === 'unknown') {
        for (const s of spans) {
            const m = getStrAttr(s, 'llm.model');
            if (m) { model = m; break; }
        }
    }

    // ── Token extraction (multi-source, multi-attribute) ──────────
    let tokensTotal = 0;
    let tokensPrompt = 0;
    let tokensCompletion = 0;
    let pipelineDurationMs = 0;
    let ragToolIterations = 0;
    let ragEventsReturned = 0;
    let ragQuery = '';

    // 1. Try the rag.pipeline span first (server-aggregated)
    if (pipelineSpan) {
        tokensTotal = getNumAttr(pipelineSpan, 'llm.total_tokens');
        tokensPrompt = getNumAttr(pipelineSpan, 'llm.total_prompt_tokens');
        tokensCompletion = getNumAttr(pipelineSpan, 'llm.total_completion_tokens');
        pipelineDurationMs = getNumAttr(pipelineSpan, 'duration_ms') || (pipelineSpan.endTimeUnixNano && pipelineSpan.startTimeUnixNano
            ? Math.round((Number(BigInt(pipelineSpan.endTimeUnixNano) - BigInt(pipelineSpan.startTimeUnixNano)) / 1_000_000))
            : 0);
        ragToolIterations = getNumAttr(pipelineSpan, 'rag.tool_iterations');
        ragEventsReturned = getNumAttr(pipelineSpan, 'rag.events_returned');
        ragQuery = getStrAttr(pipelineSpan, 'rag.query');
    }

    // 2. Walk ALL spans for any token attributes (multiple known names)
    if (tokensTotal === 0) {
        for (const s of spans) {
            tokensPrompt += getNumAttr(s, 'llm.prompt_tokens')
                || getNumAttr(s, 'llm.total_prompt_tokens')
                || getNumAttr(s, 'gen_ai.usage.prompt_tokens');
            tokensCompletion += getNumAttr(s, 'llm.completion_tokens')
                || getNumAttr(s, 'llm.total_completion_tokens')
                || getNumAttr(s, 'gen_ai.usage.completion_tokens');
            tokensTotal += getNumAttr(s, 'llm.total_tokens')
                || getNumAttr(s, 'llm.tokens_total')
                || getNumAttr(s, 'gen_ai.usage.total_tokens');
        }
        if (tokensTotal === 0) {
            tokensTotal = tokensPrompt + tokensCompletion;
        }
    }

    // 3. Concise dev-only warning when token extraction fails
    if (tokensTotal === 0 && typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[LokiExporter] tokens_total=0 — ensure your backend returns usage data and traceLLM extractTokens reads it.');
    }

    if (!ragQuery) {
        for (const s of spans) {
            const q = getStrAttr(s, 'rag.query');
            if (q) { ragQuery = q; break; }
        }
    }
    if (pipelineDurationMs === 0) {
        for (const s of spans) {
            const d = getNumAttr(s, 'llm.latency_ms');
            if (d > 0) { pipelineDurationMs = d; break; }
        }
    }

    // Cost — compute from token counts and model
    const costResult = computeCost(model, tokensPrompt, tokensCompletion);
    const costTotalUsd = costResult.total_usd;

    // Evaluation scores — scan all spans for eval attributes
    const evalScores = {
        correctness: 0,
        hallucination: 0,
        relevance: 0,
        helpfulness: 0,
        coherence: 0,
        grounding: 0,
        overall: 0,
    };
    let evalTriggered = false;
    for (const s of spans) {
        const corr = getNumAttr(s, 'llm.eval.correctness');
        if (corr > 0) {
            evalTriggered = true;
            evalScores.correctness = corr;
            evalScores.hallucination = getNumAttr(s, 'llm.eval.hallucination');
            evalScores.relevance = getNumAttr(s, 'llm.eval.relevance');
            evalScores.helpfulness = getNumAttr(s, 'llm.eval.helpfulness');
            evalScores.coherence = getNumAttr(s, 'llm.eval.coherence');
            evalScores.grounding = getNumAttr(s, 'llm.eval.grounding');
            // overall = average of correctness, relevance, (1 - hallucination)
            evalScores.overall = Number(
                ((corr + evalScores.relevance + (1 - evalScores.hallucination)) / 3).toFixed(2)
            );
            break;
        }
    }

    const evalTriggeredStr = evalTriggered ? 'true' : 'false';
    const timestamp = (Date.now() * 1_000_000).toString();

    // ── Stream labels (indexed by Loki) ──
    const stream: Record<string, string> = {
        job: 'llm-telemetry',
        app: context.app,
        platform: context.platform,
        env: context.env,
        model,
        eval_triggered: evalTriggeredStr,
    };

    // ── Log line (JSON) ──
    const logLine: Record<string, string | number | boolean> = {
        event: 'llm_trace',
        trace_id: traceId,
        timestamp: new Date().toISOString(),
        tokens_total: tokensTotal,
        tokens_prompt: tokensPrompt,
        tokens_completion: tokensCompletion,
        cost_total_usd: costTotalUsd,
        pipeline_duration_ms: pipelineDurationMs,
        rag_tool_iterations: ragToolIterations,
        rag_events_returned: ragEventsReturned,
        rag_query: ragQuery,
        eval_triggered: evalTriggeredStr,
        evaluation_scores_correctness: evalScores.correctness,
        evaluation_scores_hallucination: evalScores.hallucination,
        evaluation_scores_relevance: evalScores.relevance,
        evaluation_scores_helpfulness: evalScores.helpfulness,
        evaluation_scores_coherence: evalScores.coherence,
        evaluation_scores_grounding: evalScores.grounding,
        evaluation_scores_overall: evalScores.overall,
        model,
        platform: context.platform,
    };

    return {
        streams: [{
            stream,
            values: [[timestamp, JSON.stringify(logLine)]],
        }],
    };
}

// ─── Exporter Class ─────────────────────────────────────────────

/**
 * Loki exporter — pushes enriched LLM trace data to Grafana Loki
 * in exactly the format expected by the Grafana dashboard.
 */
export class LokiExporter implements IExporter {
    private pushUrl: string;
    private headers: Record<string, string>;
    private platform: string;
    private env: string;
    private app: string;

    constructor(config: LLMTelemetryConfig) {
        const baseUrl = (config.lokiUrl || config.collectorUrl || 'http://localhost:3100').replace(/\/+$/, '');
        this.pushUrl = `${baseUrl}/loki/api/v1/push`;
        this.platform = detectedPlatform;
        this.env = config.environment || 'production';
        this.app = config.appId || 'my-app';

        this.headers = {
            'Content-Type': 'application/json',
            ...config.headers,
        };

        if (config.apiKey) {
            this.headers['Authorization'] = `Basic ${config.apiKey}`;
        }
    }

    async export(payload: OTLPSpanPayload): Promise<ExportResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

        try {
            // Collect all spans, filtering out internal SDK spans (e.g. eval grader calls)
            const allSpans: OTLPSpan[] = [];
            for (const rs of payload.resourceSpans) {
                for (const ss of rs.scopeSpans) {
                    for (const span of ss.spans) {
                        // Skip internal spans (evaluation grader calls)
                        const isInternal = span.attributes.some(
                            (a) => a.key === 'llm.internal' && (a.value.stringValue === 'true' || a.value.boolValue === true)
                        );
                        if (!isInternal) {
                            allSpans.push(span);
                        }
                    }
                }
            }

            if (allSpans.length === 0) {
                clearTimeout(timeout);
                return { success: true, itemsExported: 0 };
            }

            // Group by traceId
            const traceGroups = new Map<string, OTLPSpan[]>();
            for (const span of allSpans) {
                const existing = traceGroups.get(span.traceId) ?? [];
                existing.push(span);
                traceGroups.set(span.traceId, existing);
            }

            // Build and push one Loki payload per trace
            let totalExported = 0;
            const context = { platform: this.platform, env: this.env, app: this.app };

            for (const [traceId, traceSpans] of traceGroups) {
                const lokiPayload = buildLokiPayload(traceSpans, traceId, context);

                try {
                    const response = await fetch(this.pushUrl, {
                        method: 'POST',
                        headers: this.headers,
                        body: JSON.stringify(lokiPayload),
                        signal: controller.signal,
                    });

                    if (response.status === 200 || response.status === 204) {
                        totalExported += traceSpans.length;
                    } else {
                        if (__DEV__) {
                            const body = await response.text().catch(() => '');
                            console.warn(`[LokiExporter] Push failed: HTTP ${response.status}`, body);
                        }
                    }
                } catch (pushErr) {
                    if (__DEV__) {
                        console.warn('[LokiExporter] Push failed:', pushErr instanceof Error ? pushErr.message : pushErr);
                    }
                }
            }

            clearTimeout(timeout);
            if (totalExported > 0) {
                return { success: true as const, itemsExported: totalExported };
            }
            return { success: false, error: 'No spans exported', retryable: true };
        } catch (err) {
            clearTimeout(timeout);
            if (__DEV__) {
                console.warn('[LokiExporter] Export failed:', err instanceof Error ? err.message : err);
            }
            const message = err instanceof Error ? err.message : 'Unknown network error';
            return { success: false, error: message, retryable: true };
        }
    }

    async shutdown(): Promise<void> {
        // No persistent connections
    }
}
