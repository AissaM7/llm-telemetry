// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Console Exporter (Development)
// ═══════════════════════════════════════════════════════════════════
// Pretty-prints enriched LLM traces to the console for dev use.

import type { IExporter, ExportResult, OTLPSpanPayload, OTLPSpan, LLMTelemetryConfig } from '../types';
import { buildEnrichedLog } from './enriched-log';
import type { EnrichedTraceLog } from './enriched-log';

// ─── Visual Helpers ─────────────────────────────────────────────

const W = 56; // total box width

function pad(text: string, width: number): string {
    if (text.length >= width) return text.substring(0, width);
    return text + ' '.repeat(width - text.length);
}

function bar(score: number, length: number = 10): string {
    const filled = Math.round(score * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function fmtUsd(usd: number): string {
    if (usd < 0.01) return `$${usd.toFixed(6)}`;
    return `$${usd.toFixed(4)}`;
}

function truncate(text: string, max: number): string {
    if (!text) return '—';
    if (text.length <= max) return text;
    return text.substring(0, max - 3) + '...';
}

function line(content: string): string {
    return `│ ${pad(content, W - 4)} │`;
}

function divider(label: string): string {
    const inner = `─ ${label} `;
    return `├${inner}${'─'.repeat(W - inner.length - 2)}┤`;
}

// ─── Exporter ───────────────────────────────────────────────────

/**
 * Development console exporter that pretty-prints enriched trace
 * data to the React Native debugger console.
 */
export class ConsoleExporter implements IExporter {
    private config?: LLMTelemetryConfig;

    constructor(config?: LLMTelemetryConfig) {
        this.config = config;
    }

    async export(payload: OTLPSpanPayload): Promise<ExportResult> {
        let totalSpans = 0;

        for (const resourceSpan of payload.resourceSpans) {
            for (const scopeSpan of resourceSpan.scopeSpans) {
                const spans = scopeSpan.spans;
                totalSpans += spans.length;

                // Group spans by trace ID
                const traceGroups = new Map<string, OTLPSpan[]>();
                for (const span of spans) {
                    const existing = traceGroups.get(span.traceId) ?? [];
                    existing.push(span);
                    traceGroups.set(span.traceId, existing);
                }

                // Print each trace group as an enriched log
                for (const [, traceSpans] of traceGroups) {
                    const enriched = buildEnrichedLog(traceSpans, this.config);
                    this.printEnrichedLog(enriched);
                }
            }
        }

        return { success: true, itemsExported: totalSpans };
    }

    private printEnrichedLog(log: EnrichedTraceLog): void {
        const lines: string[] = [
            '',
            `┌${'─ LLM TRACE '.padEnd(W - 2, '─')}┐`,
            line(`Trace:    ${log.trace_id}`),
            line(`Query:    "${truncate(log.pipeline.query, W - 16)}"`),
            line(`Response: "${truncate(log.pipeline.final_response, W - 16)}"`),
            line(`Duration: ${log.pipeline.duration_ms}ms  │  Iterations: ${log.pipeline.tool_iterations}`),
        ];

        // Tokens section
        lines.push(divider('TOKENS'));
        lines.push(line(
            `Prompt: ${log.tokens.prompt}  │  Completion: ${log.tokens.completion}  │  Total: ${log.tokens.total}`
        ));

        // Cost section
        lines.push(divider('COST'));
        lines.push(line(
            `${fmtUsd(log.cost.total_usd)} USD  (${log.cost.model})`
        ));

        // Evaluation section
        lines.push(divider('EVALUATION'));
        if (log.evaluation.triggered && log.evaluation.scores) {
            const s = log.evaluation.scores;
            if (s.correctness !== undefined) {
                lines.push(line(`Correctness:   ${s.correctness.toFixed(2)}  ${bar(s.correctness)}`));
            }
            if (s.hallucination !== undefined) {
                const label = s.hallucination <= 0.2 ? '  ✓ Clean' : s.hallucination <= 0.5 ? '  ⚠ Moderate' : '  ✗ High';
                lines.push(line(`Hallucination: ${s.hallucination.toFixed(2)}  ${bar(s.hallucination)}${label}`));
            }
            if (s.relevance !== undefined) {
                lines.push(line(`Relevance:     ${s.relevance.toFixed(2)}  ${bar(s.relevance)}`));
            }
            if (s.coherence !== undefined) {
                lines.push(line(`Coherence:     ${s.coherence.toFixed(2)}  ${bar(s.coherence)}`));
            }
            if (s.overall !== undefined) {
                lines.push(line(`Overall:       ${s.overall.toFixed(2)}  ${bar(s.overall)}`));
            }
            if (log.evaluation.graded_by) {
                lines.push(line(`Graded by: ${log.evaluation.graded_by}`));
            }
        } else {
            lines.push(line(log.evaluation.reason ?? 'Not triggered'));
        }

        lines.push(`└${'─'.repeat(W - 2)}┘`);

        // Print everything as a single grouped log
        try {
            console.group(`🔭 ${log.event} [${log.trace_id.substring(0, 8)}]`);
            console.log(lines.join('\n'));
            console.groupEnd();
        } catch {
            // console.group may not be available in all RN environments
            console.log(lines.join('\n'));
        }
    }

    async shutdown(): Promise<void> {
        // Nothing to clean up
    }
}
