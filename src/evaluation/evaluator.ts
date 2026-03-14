// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Evaluation Orchestrator
// ═══════════════════════════════════════════════════════════════════
// Orchestrates the full evaluation pipeline: rule-based pre-scoring
// followed by LLM-as-judge grading. Always completes before the span
// is exported to prevent double-emit.

import type { EvaluationParams, EvaluationResult } from '../types';
import { LLMSpan } from '../core/span';
import { quickHallucinationScore } from './hallucination';
import { gradeResponse } from './grader';

interface EvaluatorConfig {
    enabled: boolean;
    /** @deprecated Ignored — evaluation always completes before export. */
    async?: boolean;
    apiKey?: string;
    model?: string;
    endpoint?: string;
}

// Circuit breaker: stop grading after N consecutive failures, reset after cooldown
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000; // 60 seconds

/**
 * Orchestrates the full evaluation pipeline:
 * 1. Quick rule-based hallucination pre-score (synchronous)
 * 2. LLM-as-judge grading (always awaited before returning)
 *
 * The evaluate() method always resolves only after ALL scoring stages
 * have completed and written their scores to the span. This guarantees
 * a single Loki log per request with complete evaluation data.
 *
 * Includes a circuit breaker: after 3 consecutive grading failures,
 * grading is skipped for 60 seconds to avoid wasting API credits.
 */
export class ResponseEvaluator {
    private config: EvaluatorConfig;
    private consecutiveFailures = 0;
    private circuitOpenUntil = 0;

    constructor(config: EvaluatorConfig) {
        this.config = config;
    }

    /**
     * @deprecated No longer needed — eval scores are always set on the original span.
     */
    setSpanCallback(_callback: (span: LLMSpan) => void): void {
        // No-op: kept for API compatibility but no longer used.
    }

    /**
     * Evaluate an LLM response and attach scores to the span.
     * Always awaits the full grading pipeline before returning —
     * the caller (tracer.endSpan) must not export the span until
     * this Promise resolves.
     *
     * @returns EvaluationResult on success, null on failure or if disabled
     */
    async evaluate(
        params: EvaluationParams,
        span: LLMSpan
    ): Promise<EvaluationResult | null> {
        if (!this.config.enabled) return null;

        try {
            // Step 1: Quick rule-based hallucination pre-score
            if (params.retrievedDocuments && params.retrievedDocuments.length > 0) {
                const quickScore = quickHallucinationScore(params.response, params.retrievedDocuments);
                span.setAttribute('llm.eval.hallucination', Number(quickScore.toFixed(2)));
            }

            // Step 2: LLM-as-judge grading (if API key is available)
            if (!this.config.apiKey) {
                return null;
            }

            // Circuit breaker: skip grading if too many consecutive failures
            if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
                if (Date.now() < this.circuitOpenUntil) {
                    // Circuit is open — skip grading to save API costs
                    return null;
                }
                // Cooldown expired — reset and try again
                this.consecutiveFailures = 0;
            }

            const graderConfig = {
                apiKey: this.config.apiKey,
                model: this.config.model,
                endpoint: this.config.endpoint,
            };

            // Always await grading — scores must land on the span before export.
            // Timeout prevents slow grading from blocking span export indefinitely.
            const GRADING_TIMEOUT_MS = 10_000;
            const timeoutPromise = new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), GRADING_TIMEOUT_MS)
            );
            const result = await Promise.race([
                gradeResponse(params, graderConfig),
                timeoutPromise,
            ]);
            if (result) {
                // Success — reset circuit breaker
                this.consecutiveFailures = 0;
                this.updateSpanWithGrades(span, result);
            } else {
                // Grading returned null (failed, timed out, or invalid response)
                this.consecutiveFailures++;
                if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
                    this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
                }
            }
            return result;
        } catch {
            // Never throw from evaluation
            return null;
        }
    }

    /**
     * Attach evaluation grades directly to the original span.
     * Scores are always set on the original span (never a sibling).
     */
    private updateSpanWithGrades(span: LLMSpan, grades: EvaluationResult): void {
        span.setAttribute('llm.eval.correctness', grades.correctness);
        span.setAttribute('llm.eval.hallucination', grades.hallucination);
        span.setAttribute('llm.eval.relevance', grades.relevance);
        span.setAttribute('llm.eval.helpfulness', grades.helpfulness);
        span.setAttribute('llm.eval.coherence', grades.coherence);
        span.setAttribute('llm.eval.grounding', grades.grounding);
        span.setAttribute('llm.eval.reasoning', grades.reasoning);
        span.setAttribute('llm.eval.grader_model', grades.graderModel);
        span.setAttribute('llm.eval.graded_at', grades.gradedAt);
    }
}
