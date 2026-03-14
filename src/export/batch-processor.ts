// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Batch Processor
// ═══════════════════════════════════════════════════════════════════
// Queues, batches, retries, and offline-buffers spans before export.
// This is the reliability layer between the tracer and exporters.

import type { IExporter, LLMTelemetryConfig, OTLPSpanPayload, KeyValue } from '../types';
import { LLMSpan } from '../core/span';

const OFFLINE_BUFFER_KEY = 'llm_telemetry_buffer';
const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_SEEN_IDS = 1000;

// Lazy-loaded AsyncStorage
let _asyncStorage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
} | null = null;

function getAsyncStorage(): typeof _asyncStorage {
    if (_asyncStorage) return _asyncStorage;
    try {
        _asyncStorage = require('@react-native-async-storage/async-storage').default;
    } catch {
        const mem = new Map<string, string>();
        _asyncStorage = {
            getItem: async (k: string) => mem.get(k) ?? null,
            setItem: async (k: string, v: string) => { mem.set(k, v); },
            removeItem: async (k: string) => { mem.delete(k); },
        };
    }
    return _asyncStorage;
}

/**
 * Batch processor that queues spans, groups into OTLP payloads,
 * and exports with automatic retry and offline buffering.
 */
export class BatchProcessor {
    private exporter: IExporter;
    private queue: LLMSpan[] = [];
    private seenSpanIds: Set<string> = new Set();
    private seenSpanOrder: string[] = []; // FIFO order for cleanup
    private batchSize: number;
    private maxQueueSize: number;
    private flushIntervalMs: number;
    private serviceName: string;
    private serviceVersion: string;
    private environment: string;
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private retryTimeouts: Array<ReturnType<typeof setTimeout>> = [];
    private onError?: (error: string, context: { phase: 'export' | 'evaluation' | 'session' | 'init'; retryable: boolean }) => void;

    constructor(exporter: IExporter, config: LLMTelemetryConfig) {
        this.exporter = exporter;
        this.batchSize = config.batchSize ?? 10;
        this.maxQueueSize = config.maxQueueSize ?? 100;
        this.flushIntervalMs = config.flushIntervalMs ?? 30_000;
        this.serviceName = config.serviceName ?? 'llm-app';
        this.serviceVersion = config.serviceVersion ?? '1.0.0';
        this.environment = config.environment ?? 'production';
        this.onError = config.onError;

        this.scheduleFlush();
    }

    /**
     * Add a completed span to the queue.
     * Deduplicates by spanId, drops oldest if queue is full.
     */
    add(span: LLMSpan): void {
        // Deduplicate
        if (this.seenSpanIds.has(span.spanId)) {
            return;
        }

        // Drop oldest if queue is full
        if (this.queue.length >= this.maxQueueSize) {
            const dropped = this.queue.shift();
            if (dropped) {
                this.seenSpanIds.delete(dropped.spanId);
            }
            console.warn('[LLMTelemetry] Queue full — dropping oldest span');
        }

        this.seenSpanIds.add(span.spanId);
        this.seenSpanOrder.push(span.spanId);

        // Prevent unbounded memory growth in long sessions
        if (this.seenSpanIds.size > MAX_SEEN_IDS) {
            const toRemove = this.seenSpanOrder.shift();
            if (toRemove) this.seenSpanIds.delete(toRemove);
        }

        this.queue.push(span);

        // Auto-flush at batch size
        if (this.queue.length >= this.batchSize) {
            void this.flush().catch(() => {
                // Silently handle — never crash
            });
        }
    }

    /**
     * Flush all queued spans to the exporter.
     */
    async flush(): Promise<void> {
        if (this.queue.length === 0) return;

        // Snapshot and clear
        const batch = [...this.queue];
        this.queue = [];
        // Keep seenSpanIds to prevent re-adding flushed spans

        const payload = this.buildOTLPPayload(batch);
        const result = await this.exporter.export(payload);

        if (!result.success) {
            // Notify via onError callback
            this.onError?.(result.error, { phase: 'export', retryable: result.retryable });

            // Move failed spans to offline buffer
            await this.saveToOfflineBuffer(batch);

            if (result.retryable) {
                this.scheduleRetry(batch, 1);
            }
        }
        // Note: seenSpanIds are intentionally NOT cleared on success.
        // This prevents re-export if a periodic flush or app-state
        // flush re-encounters the same span.
    }

    /**
     * Retry previously failed spans from offline storage.
     */
    async retryOfflineBuffer(): Promise<void> {
        try {
            const storage = getAsyncStorage();
            const stored = await storage?.getItem(OFFLINE_BUFFER_KEY);
            if (!stored) return;

            // Validate buffer integrity before parsing
            let payload: OTLPSpanPayload;
            try {
                payload = JSON.parse(stored);
                // Basic structural validation
                if (!payload?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans) {
                    // Corrupted buffer — clear it
                    await storage?.removeItem(OFFLINE_BUFFER_KEY);
                    return;
                }
            } catch {
                // Unparseable buffer — clear it
                await storage?.removeItem(OFFLINE_BUFFER_KEY);
                return;
            }

            const result = await this.exporter.export(payload);

            if (result.success) {
                await storage?.removeItem(OFFLINE_BUFFER_KEY);
            }
        } catch {
            // Silently handle
        }
    }

    /**
     * Build a complete OTLP span payload from a batch of LLMSpans.
     */
    buildOTLPPayload(spans: LLMSpan[]): OTLPSpanPayload {
        const resourceAttributes: KeyValue[] = [
            { key: 'service.name', value: { stringValue: this.serviceName } },
            { key: 'service.version', value: { stringValue: this.serviceVersion } },
            { key: 'telemetry.sdk.name', value: { stringValue: '@llm-telemetry/react-native' } },
            { key: 'telemetry.sdk.version', value: { stringValue: '1.0.0' } },
            { key: 'telemetry.sdk.language', value: { stringValue: 'javascript' } },
            { key: 'deployment.environment', value: { stringValue: this.environment } },
        ];

        return {
            resourceSpans: [{
                resource: { attributes: resourceAttributes },
                scopeSpans: [{
                    scope: {
                        name: '@llm-telemetry/react-native',
                        version: '1.0.0',
                    },
                    spans: spans.map((span) => span.toOTLP()),
                }],
            }],
        };
    }

    /**
     * Stop the flush interval and export remaining spans.
     */
    async shutdown(): Promise<void> {
        // Clear flush interval
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }

        // Clear retry timeouts
        for (const timeout of this.retryTimeouts) {
            clearTimeout(timeout);
        }
        this.retryTimeouts = [];

        // Final flush
        await this.flush();
    }

    /**
     * Schedule periodic flushes.
     */
    private scheduleFlush(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        this.flushTimer = setInterval(() => {
            void this.flush().catch(() => { });
        }, this.flushIntervalMs);
    }

    /**
     * Schedule a retry with exponential backoff.
     */
    private scheduleRetry(spans: LLMSpan[], attempt: number): void {
        if (attempt > MAX_RETRIES) return;

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
        const timeout = setTimeout(async () => {
            try {
                const payload = this.buildOTLPPayload(spans);
                const result = await this.exporter.export(payload);

                if (result.success) {
                    // Clear offline buffer on successful retry
                    const storage = getAsyncStorage();
                    await storage?.removeItem(OFFLINE_BUFFER_KEY);
                    for (const span of spans) {
                        this.seenSpanIds.delete(span.spanId);
                    }
                } else if (result.retryable) {
                    this.scheduleRetry(spans, attempt + 1);
                }
            } catch {
                // Silently handle
            }
        }, delay);

        this.retryTimeouts.push(timeout);
    }

    /**
     * Save failed spans to AsyncStorage for retry on next launch.
     */
    private async saveToOfflineBuffer(spans: LLMSpan[]): Promise<void> {
        try {
            const storage = getAsyncStorage();
            const payload = this.buildOTLPPayload(spans);

            // Merge with existing buffer
            const existing = await storage?.getItem(OFFLINE_BUFFER_KEY);
            if (existing) {
                try {
                    const existingPayload: OTLPSpanPayload = JSON.parse(existing);
                    if (existingPayload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans) {
                        const existingSpans = existingPayload.resourceSpans[0].scopeSpans[0].spans;
                        const newSpans = payload.resourceSpans[0].scopeSpans[0].spans;
                        existingPayload.resourceSpans[0].scopeSpans[0].spans = [
                            ...existingSpans,
                            ...newSpans,
                        ];
                        await storage?.setItem(OFFLINE_BUFFER_KEY, JSON.stringify(existingPayload));
                        return;
                    }
                } catch {
                    // Corrupt existing buffer — overwrite
                }
            }

            await storage?.setItem(OFFLINE_BUFFER_KEY, JSON.stringify(payload));
        } catch {
            // Silently handle — can't even buffer offline
        }
    }
}
