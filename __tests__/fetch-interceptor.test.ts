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
if (typeof globalThis.performance === 'undefined') {
    (globalThis as any).performance = { now: () => Date.now() };
}

import { LLMTracer } from '../src/core/tracer';
import { installFetchInterceptor, uninstallFetchInterceptor } from '../src/instrumentation/fetch-interceptor';
import type { LLMTelemetryConfig } from '../src/types';

const TEST_CONFIG: LLMTelemetryConfig = {
    exporterType: 'console',
    collectorUrl: 'http://localhost:4318',
    enabled: true,
    sampleRate: 1.0,
    evaluationEnabled: false,
    batchSize: 100,
    flushIntervalMs: 60000,
};

describe('FetchInterceptor', () => {
    let tracer: LLMTracer;
    let mockFetch: jest.Mock;
    let originalGlobalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
        LLMTracer.resetInstance();
        tracer = LLMTracer.getInstance();
        await tracer.init(TEST_CONFIG);

        mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            clone: () => ({
                json: () => Promise.resolve({
                    id: 'chatcmpl-123',
                    model: 'gpt-4o',
                    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                    choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
                }),
            }),
        });

        originalGlobalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;
    });

    afterEach(() => {
        uninstallFetchInterceptor();
        globalThis.fetch = originalGlobalFetch;
        LLMTracer.resetInstance();
    });

    it('intercepts calls to api.openai.com', async () => {
        installFetchInterceptor(tracer);
        await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
        });
        expect(mockFetch).toHaveBeenCalled();
        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[0]).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('intercepts calls to api.anthropic.com', async () => {
        installFetchInterceptor(tracer);
        mockFetch.mockResolvedValueOnce({
            ok: true, status: 200, statusText: 'OK',
            clone: () => ({
                json: () => Promise.resolve({
                    id: 'msg_123', usage: { input_tokens: 80, output_tokens: 40 },
                    content: [{ text: 'Hi there' }], stop_reason: 'end_turn',
                }),
            }),
        });
        await globalThis.fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            body: JSON.stringify({ model: 'claude-3', messages: [] }),
        });
        expect(mockFetch).toHaveBeenCalled();
    });

    it('does NOT intercept unrelated fetch calls', async () => {
        installFetchInterceptor(tracer);
        await globalThis.fetch('https://api.example.com/data');
        expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/data', undefined);
    });

    it('injects traceparent header', async () => {
        installFetchInterceptor(tracer);
        await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
        });
        const callInit = mockFetch.mock.calls[0][1];
        const headers = callInit.headers;
        expect(headers instanceof Headers ? headers.get('traceparent') : undefined).toBeTruthy();
    });

    it('parses OpenAI token usage from response body', async () => {
        const endSpanSpy = jest.spyOn(tracer, 'endSpan');
        installFetchInterceptor(tracer);
        await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'test' }] }),
        });
        expect(endSpanSpy).toHaveBeenCalled();
        const span = endSpanSpy.mock.calls[0][0];
        expect(span.getAttribute('llm.prompt_tokens')).toBe(100);
        expect(span.getAttribute('llm.completion_tokens')).toBe(50);
        endSpanSpy.mockRestore();
    });

    it('handles fetch errors gracefully', async () => {
        installFetchInterceptor(tracer);
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        await expect(
            globalThis.fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
            })
        ).rejects.toThrow('Network error');
    });
});
