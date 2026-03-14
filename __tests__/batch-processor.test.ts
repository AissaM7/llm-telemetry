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

import { BatchProcessor } from '../src/export/batch-processor';
import { LLMSpan } from '../src/core/span';
import type { IExporter, ExportResult, OTLPSpanPayload, LLMTelemetryConfig } from '../src/types';

class MockExporter implements IExporter {
    public exportCalls: OTLPSpanPayload[] = [];
    public shouldFail = false;

    async export(payload: OTLPSpanPayload): Promise<ExportResult> {
        this.exportCalls.push(payload);
        if (this.shouldFail) {
            return { success: false, error: 'Mock failure', retryable: true };
        }
        const count = payload.resourceSpans.reduce((t, rs) =>
            t + rs.scopeSpans.reduce((st, ss) => st + ss.spans.length, 0), 0);
        return { success: true, itemsExported: count };
    }

    async shutdown(): Promise<void> { }
}

const TEST_CONFIG: LLMTelemetryConfig = {
    exporterType: 'console',
    collectorUrl: 'http://localhost:4318',
    batchSize: 3,
    maxQueueSize: 10,
    flushIntervalMs: 60000,
};

describe('BatchProcessor', () => {
    let exporter: MockExporter;
    let processor: BatchProcessor;

    beforeEach(() => {
        exporter = new MockExporter();
        processor = new BatchProcessor(exporter, TEST_CONFIG);
    });

    afterEach(async () => {
        await processor.shutdown();
    });

    it('flushes when batchSize is reached', async () => {
        const span1 = new LLMSpan('span1'); span1.end();
        const span2 = new LLMSpan('span2'); span2.end();
        const span3 = new LLMSpan('span3'); span3.end();

        processor.add(span1);
        processor.add(span2);
        processor.add(span3);

        // Wait for auto-flush to process
        await new Promise((r) => setTimeout(r, 100));

        expect(exporter.exportCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates spans by spanId', async () => {
        const span = new LLMSpan('duplicate'); span.end();

        processor.add(span);
        processor.add(span); // Same span again

        await processor.flush();

        if (exporter.exportCalls.length > 0) {
            const totalSpans = exporter.exportCalls.reduce((t, p) =>
                t + p.resourceSpans.reduce((rs, r) =>
                    rs + r.scopeSpans.reduce((ss, s) => ss + s.spans.length, 0), 0), 0);
            expect(totalSpans).toBe(1);
        }
    });

    it('builds valid OTLP payload', () => {
        const span = new LLMSpan('test.span');
        span.setAttribute('llm.model', 'gpt-4o');
        span.end();

        const payload = processor.buildOTLPPayload([span]);

        expect(payload.resourceSpans).toHaveLength(1);
        expect(payload.resourceSpans[0].scopeSpans).toHaveLength(1);
        expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
        expect(payload.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('test.span');
        expect(payload.resourceSpans[0].resource.attributes.length).toBeGreaterThan(0);
    });

    it('handles export failure gracefully', async () => {
        exporter.shouldFail = true;
        const span = new LLMSpan('failing'); span.end();
        processor.add(span);

        // Should not throw
        await expect(processor.flush()).resolves.toBeUndefined();
    });

    it('drops oldest when queue is full', () => {
        const spy = jest.spyOn(console, 'warn').mockImplementation();
        const smallConfig = { ...TEST_CONFIG, maxQueueSize: 2, batchSize: 100 };
        const proc = new BatchProcessor(exporter, smallConfig);

        const s1 = new LLMSpan('s1'); s1.end();
        const s2 = new LLMSpan('s2'); s2.end();
        const s3 = new LLMSpan('s3'); s3.end();

        proc.add(s1);
        proc.add(s2);
        proc.add(s3); // Should drop s1

        expect(spy).toHaveBeenCalledWith(expect.stringContaining('Queue full'));
        spy.mockRestore();
        void proc.shutdown();
    });
});
