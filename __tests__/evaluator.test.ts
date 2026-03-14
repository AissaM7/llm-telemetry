// Mock crypto for Node.js test environment
if (typeof globalThis.crypto === 'undefined') {
    const nodeCrypto = require('crypto');
    (globalThis as any).crypto = {
        getRandomValues: (buffer: Uint8Array) => {
            const bytes = nodeCrypto.randomBytes(buffer.length);
            buffer.set(bytes);
            return buffer;
        },
    };
}
if (typeof globalThis.performance === 'undefined') {
    (globalThis as any).performance = { now: () => Date.now() };
}

import { quickHallucinationScore } from '../src/evaluation/hallucination';
import { gradeResponse } from '../src/evaluation/grader';

describe('Evaluator', () => {
    describe('quickHallucinationScore', () => {
        it('returns higher score for responses with facts not in documents', () => {
            const docs = ['The event is on Saturday at Central Park. Tickets cost $20.'];
            const grounded = 'The event is at Central Park on Saturday.';
            const hallucinated = 'The concert features Taylor Swift performing at Madison Square Garden on Friday for $500.';

            const groundedScore = quickHallucinationScore(grounded, docs);
            const hallucinatedScore = quickHallucinationScore(hallucinated, docs);

            expect(hallucinatedScore).toBeGreaterThan(groundedScore);
        });

        it('returns 0.5 for empty documents', () => {
            expect(quickHallucinationScore('some response', [])).toBe(0.5);
        });

        it('returns score between 0 and 1', () => {
            const score = quickHallucinationScore(
                'The weather is sunny today',
                ['Today the weather forecast shows sunny skies']
            );
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
        });
    });

    describe('gradeResponse', () => {
        it('returns null on network failure (no throw)', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

            const result = await gradeResponse(
                { query: 'test', response: 'test response' },
                { apiKey: 'test-key', timeoutMs: 1000 }
            );

            expect(result).toBeNull();
            globalThis.fetch = originalFetch;
        });

        it('returns null on malformed JSON (no throw)', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: 'not valid json at all' } }],
                }),
            });

            const result = await gradeResponse(
                { query: 'test', response: 'test response' },
                { apiKey: 'test-key', timeoutMs: 1000 }
            );

            expect(result).toBeNull();
            globalThis.fetch = originalFetch;
        });

        it('returns null on timeout (no throw)', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = jest.fn().mockImplementation((_url, opts) => {
                return new Promise((_, reject) => {
                    const signal = opts?.signal;
                    if (signal) {
                        signal.addEventListener('abort', () => reject(new Error('Aborted')));
                    }
                });
            });

            const result = await gradeResponse(
                { query: 'test', response: 'test response' },
                { apiKey: 'test-key', timeoutMs: 100 }
            );

            expect(result).toBeNull();
            globalThis.fetch = originalFetch;
        });
    });

    describe('enriched evaluation schema', () => {
        const { buildEnrichedLog } = require('../src/export/enriched-log');
        const { computeCost } = require('../src/cost/pricing');

        it('evaluation block matches Task 3e schema when scores are present', () => {
            const spans = [{
                traceId: 'trace-1',
                spanId: 'span-1',
                name: 'llm.api_call',
                kind: 2,
                startTimeUnixNano: '1000000000000000',
                endTimeUnixNano: '1003000000000000',
                attributes: [
                    { key: 'llm.model', value: { stringValue: 'gpt-4o' } },
                    { key: 'llm.response', value: { stringValue: 'Here are events.' } },
                    { key: 'rag.query', value: { stringValue: 'events today' } },
                    { key: 'llm.prompt_tokens', value: { intValue: '500' } },
                    { key: 'llm.completion_tokens', value: { intValue: '100' } },
                    { key: 'llm.eval.correctness', value: { doubleValue: 0.91 } },
                    { key: 'llm.eval.hallucination', value: { doubleValue: 0.04 } },
                    { key: 'llm.eval.relevance', value: { doubleValue: 0.88 } },
                    { key: 'llm.eval.helpfulness', value: { doubleValue: 0.85 } },
                    { key: 'llm.eval.coherence', value: { doubleValue: 0.95 } },
                    { key: 'llm.eval.grounding', value: { doubleValue: 0.87 } },
                ],
                status: { code: 1 },
            }];

            const enriched = buildEnrichedLog(spans, { evaluationEnabled: true });

            // Top-level envelope
            expect(enriched.event).toBe('llm_trace');
            expect(enriched.schema_version).toBe('1.1');

            // Evaluation block structure
            const evalBlock = enriched.evaluation;
            expect(evalBlock.enabled).toBe(true);
            expect(evalBlock.triggered).toBe(true);
            expect(evalBlock.scores).toBeDefined();
            expect(evalBlock.scores.correctness).toBe(0.91);
            expect(evalBlock.scores.hallucination).toBe(0.04);
            expect(evalBlock.scores.relevance).toBe(0.88);
            expect(evalBlock.scores.coherence).toBe(0.95);
            expect(evalBlock.scores.grounding).toBe(0.87);
            expect(evalBlock.scores.overall).toBeGreaterThan(0);
            expect(evalBlock.scores.overall).toBeLessThanOrEqual(1);

            // Cost block
            expect(enriched.cost).toBeDefined();
            expect(enriched.cost.currency).toBe('USD');
            expect(enriched.cost.total_usd).toBeGreaterThan(0);

            // Flattened keys
            expect(enriched.tokens_total).toBe(600);
            expect(enriched.evaluation_scores_correctness).toBe(0.91);
        });

        it('evaluation block shows reason when disabled', () => {
            const spans = [{
                traceId: 'trace-2',
                spanId: 'span-2',
                name: 'llm.api_call',
                kind: 2,
                startTimeUnixNano: '1000000000000000',
                endTimeUnixNano: '1003000000000000',
                attributes: [
                    { key: 'llm.model', value: { stringValue: 'gpt-4o' } },
                ],
                status: { code: 1 },
            }];

            const enriched = buildEnrichedLog(spans, { evaluationEnabled: false });

            expect(enriched.evaluation.enabled).toBe(false);
            expect(enriched.evaluation.triggered).toBe(false);
            expect(enriched.evaluation.reason).toContain('evaluationEnabled=false');
        });
    });
});
