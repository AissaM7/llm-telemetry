// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Loki Exporter Tests
// ═══════════════════════════════════════════════════════════════════

import { buildLokiPayload } from '../src/export/loki';
import type { OTLPSpan } from '../src/types';

function makeSpan(overrides: Partial<OTLPSpan> & { name: string }): OTLPSpan {
    return {
        traceId: 'trace-xyz',
        spanId: Math.random().toString(36).slice(2, 10),
        name: overrides.name,
        kind: 1,
        startTimeUnixNano: '1741739851000000000',
        endTimeUnixNano: '1741739858000000000',
        status: { code: 1 },
        attributes: overrides.attributes ?? [],
        parentSpanId: overrides.parentSpanId,
    };
}

describe('LokiExporter', () => {
    describe('buildLokiPayload', () => {
        const baseContext = { platform: 'ios', env: 'development', app: 'locall' };

        it('builds correct Loki push payload from spans', () => {
            const spans: OTLPSpan[] = [
                makeSpan({
                    name: 'rag.pipeline',
                    attributes: [
                        { key: 'rag.query', value: { stringValue: 'test query' } },
                        { key: 'llm.total_tokens', value: { intValue: '1869' } },
                        { key: 'llm.total_prompt_tokens', value: { intValue: '1729' } },
                        { key: 'llm.total_completion_tokens', value: { intValue: '140' } },
                        { key: 'rag.tool_iterations', value: { intValue: '2' } },
                        { key: 'rag.events_returned', value: { intValue: '5' } },
                    ],
                }),
                makeSpan({
                    name: 'llm.completion',
                    parentSpanId: 'abc123',
                    attributes: [
                        { key: 'llm.model', value: { stringValue: 'gpt-4o-2024-08-06' } },
                        { key: 'llm.prompt_tokens', value: { intValue: '1729' } },
                        { key: 'llm.completion_tokens', value: { intValue: '140' } },
                    ],
                }),
            ];

            const payload = buildLokiPayload(spans, 'trace-xyz', baseContext);

            // Stream labels
            expect(payload.streams).toHaveLength(1);
            expect(payload.streams[0].stream.job).toBe('llm-telemetry');
            expect(payload.streams[0].stream.app).toBe('locall');
            expect(payload.streams[0].stream.platform).toBe('ios');
            expect(payload.streams[0].stream.env).toBe('development');
            expect(payload.streams[0].stream.model).toBe('gpt-4o-2024-08-06');
            expect(payload.streams[0].stream.eval_triggered).toBe('false');

            // Values tuple
            expect(payload.streams[0].values).toHaveLength(1);
            const [timestamp, logLine] = payload.streams[0].values[0];

            // 19-digit nanosecond timestamp
            expect(timestamp).toMatch(/^\d{16,19}$/);

            // Log line fields
            const parsed = JSON.parse(logLine);
            expect(parsed.event).toBe('llm_trace');
            expect(parsed.trace_id).toBe('trace-xyz');
            expect(parsed.tokens_total).toBe(1869);
            expect(parsed.tokens_prompt).toBe(1729);
            expect(parsed.tokens_completion).toBe(140);
            expect(parsed.pipeline_duration_ms).toBeDefined();
            expect(parsed.rag_tool_iterations).toBe(2);
            expect(parsed.rag_events_returned).toBe(5);
            expect(parsed.model).toBe('gpt-4o-2024-08-06');
            expect(parsed.platform).toBe('ios');
            expect(parsed.eval_triggered).toBe('false');
        });

        it('extracts model from llm.completion spans', () => {
            const spans: OTLPSpan[] = [
                makeSpan({ name: 'rag.pipeline', attributes: [] }),
                makeSpan({
                    name: 'llm.completion',
                    attributes: [
                        { key: 'llm.model', value: { stringValue: 'claude-3-opus' } },
                    ],
                }),
            ];

            const payload = buildLokiPayload(spans, 'trace-abc', baseContext);
            expect(payload.streams[0].stream.model).toBe('claude-3-opus');
        });

        it('defaults model to unknown when no llm.model found', () => {
            const spans: OTLPSpan[] = [
                makeSpan({ name: 'rag.pipeline', attributes: [] }),
            ];

            const payload = buildLokiPayload(spans, 'trace-no-model', baseContext);
            expect(payload.streams[0].stream.model).toBe('unknown');
        });

        it('detects eval_triggered when eval scores are present', () => {
            const spans: OTLPSpan[] = [
                makeSpan({
                    name: 'llm.completion',
                    attributes: [
                        { key: 'llm.model', value: { stringValue: 'gpt-4o' } },
                        { key: 'llm.eval.correctness', value: { doubleValue: 0.91 } },
                        { key: 'llm.eval.hallucination', value: { doubleValue: 0.04 } },
                        { key: 'llm.eval.relevance', value: { doubleValue: 0.88 } },
                    ],
                }),
            ];

            const payload = buildLokiPayload(spans, 'trace-eval', baseContext);
            expect(payload.streams[0].stream.eval_triggered).toBe('true');

            const parsed = JSON.parse(payload.streams[0].values[0][1]);
            expect(parsed.eval_triggered).toBe('true');
            expect(parsed.evaluation_scores_correctness).toBe(0.91);
            expect(parsed.evaluation_scores_hallucination).toBe(0.04);
            expect(parsed.evaluation_scores_relevance).toBe(0.88);
            expect(parsed.evaluation_scores_overall).toBeGreaterThan(0);
        });

        it('falls back to client-side span attributes when pipeline span is missing', () => {
            const spans: OTLPSpan[] = [
                makeSpan({
                    name: 'llm.completion',
                    attributes: [
                        { key: 'llm.model', value: { stringValue: 'gpt-4o' } },
                        { key: 'rag.query', value: { stringValue: 'find coffee events' } },
                        { key: 'llm.latency_ms', value: { intValue: '3500' } },
                        { key: 'llm.prompt_tokens', value: { intValue: '500' } },
                        { key: 'llm.completion_tokens', value: { intValue: '150' } },
                    ],
                }),
            ];

            const payload = buildLokiPayload(spans, 'trace-client', baseContext);
            const parsed = JSON.parse(payload.streams[0].values[0][1]);
            expect(parsed.rag_query).toBe('find coffee events');
            expect(parsed.pipeline_duration_ms).toBe(3500);
            expect(parsed.tokens_prompt).toBe(500);
            expect(parsed.tokens_completion).toBe(150);
        });

        it('all stream label values are strings', () => {
            const spans: OTLPSpan[] = [
                makeSpan({
                    name: 'llm.completion',
                    attributes: [
                        { key: 'llm.model', value: { stringValue: 'gpt-4o' } },
                    ],
                }),
            ];

            const payload = buildLokiPayload(spans, 'trace-labels', baseContext);
            const stream = payload.streams[0].stream;
            for (const [, value] of Object.entries(stream)) {
                expect(typeof value).toBe('string');
            }
        });
    });
});
