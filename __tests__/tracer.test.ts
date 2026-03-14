import { LLMTracer } from '../src/core/tracer';
import { LLMSpan } from '../src/core/span';
import type { LLMTelemetryConfig } from '../src/types';

// Mock crypto.getRandomValues for Node.js test environment
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

// Mock performance.now if not available
if (typeof globalThis.performance === 'undefined') {
    (globalThis as any).performance = { now: () => Date.now() };
}

const TEST_CONFIG: LLMTelemetryConfig = {
    exporterType: 'console',
    collectorUrl: 'http://localhost:4318',
    serviceName: 'test-service',
    serviceVersion: '1.0.0',
    environment: 'test',
    enabled: true,
    sampleRate: 1.0,
    evaluationEnabled: false,
    batchSize: 10,
    flushIntervalMs: 60000,
};

describe('LLMTracer', () => {
    beforeEach(() => {
        LLMTracer.resetInstance();
    });

    afterEach(async () => {
        LLMTracer.resetInstance();
    });

    it('returns singleton instance', () => {
        const a = LLMTracer.getInstance();
        const b = LLMTracer.getInstance();
        expect(a).toBe(b);
    });

    it('initializes correctly', async () => {
        const tracer = LLMTracer.getInstance();
        await tracer.init(TEST_CONFIG);
        expect(tracer.isInitialized()).toBe(true);
    });

    it('warns on double init', async () => {
        const spy = jest.spyOn(console, 'warn').mockImplementation();
        const tracer = LLMTracer.getInstance();
        await tracer.init(TEST_CONFIG);
        await tracer.init(TEST_CONFIG);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('already initialized'));
        spy.mockRestore();
    });

    it('startSpan returns LLMSpan with correct attributes', async () => {
        const tracer = LLMTracer.getInstance();
        await tracer.init(TEST_CONFIG);

        const span = tracer.startSpan('test.span', {
            attributes: {
                'llm.model': 'gpt-4o',
                'llm.provider': 'openai',
                'llm.streaming': false,
                'llm.latency_ms': 0,
                'mobile.platform': 'ios',
                'mobile.os_version': '17.0',
                'mobile.app_version': 'unknown',
                'session.id': 'test',
            },
        });

        expect(span).toBeInstanceOf(LLMSpan);
        expect(span.name).toBe('test.span');
        expect(span.traceId).toHaveLength(32);
        expect(span.spanId).toHaveLength(16);
        expect(span.getAttribute('llm.model')).toBe('gpt-4o');
    });

    it('sample rate 0 still creates spans (no-op by convention)', async () => {
        const tracer = LLMTracer.getInstance();
        await tracer.init({ ...TEST_CONFIG, sampleRate: 0 });

        // With sampleRate 0, Math.random() > 0 is always true, so spans are sampled out
        // But we still return a span object (it just won't be exported)
        const span = tracer.startSpan('sampled.out');
        expect(span).toBeDefined();
        expect(span.name).toBe('sampled.out');
    });

    it('mobile attributes are auto-attached', async () => {
        const tracer = LLMTracer.getInstance();
        await tracer.init(TEST_CONFIG);

        const span = tracer.startSpan('test.mobile');
        // Platform mock returns 'ios'
        expect(span.getAttribute('mobile.platform')).toBe('ios');
        expect(span.getAttribute('session.id')).toBeDefined();
    });

    it('startTrace returns valid TraceHandle', async () => {
        const tracer = LLMTracer.getInstance();
        await tracer.init(TEST_CONFIG);

        const handle = tracer.startTrace('test.trace');
        expect(handle.traceId).toHaveLength(32);
        expect(handle.spanId).toHaveLength(16);
        expect(handle.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
        expect(handle.startTime).toBeGreaterThan(0);
    });

    it('flush completes without error', async () => {
        const tracer = LLMTracer.getInstance();
        await tracer.init(TEST_CONFIG);

        const span = tracer.startSpan('test.flush');
        span.setStatus('OK');
        tracer.endSpan(span);

        await expect(tracer.flush()).resolves.toBeUndefined();
    });

    it('shutdown completes without error', async () => {
        const tracer = LLMTracer.getInstance();
        await tracer.init(TEST_CONFIG);
        await expect(tracer.shutdown()).resolves.toBeUndefined();
        expect(tracer.isInitialized()).toBe(false);
    });
});
