// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — LLMTracer (Singleton)
// ═══════════════════════════════════════════════════════════════════
// Central tracer class that manages span lifecycle, session tracking,
// evaluation, and export. Entry point for all SDK operations.

import type { LLMTelemetryConfig, LLMSpanAttributes, TraceHandle } from '../types';
import { SpanKind } from '../types';
import { LLMSpan } from './span';
import { generateTraceId } from './id';
import { nowMs } from './clock';
import { buildTraceparent } from './context';
import { MobileAttributeBuilder } from '../attributes/mobile';
import { Sanitizer } from '../sanitizer/sanitizer';
import { SessionManager } from '../session/session-manager';
import { AppStateListener } from '../session/app-state-listener';
import { BatchProcessor } from '../export/batch-processor';
import { createExporter, NoopExporter } from '../export/exporter';
import { ResponseEvaluator } from '../evaluation/evaluator';
import type { IExporter } from '../types';

/**
 * LLMTracer is the main entry point for the SDK.
 * Implemented as a singleton — use LLMTracer.getInstance().
 */
export class LLMTracer {
    private static instance: LLMTracer | null = null;

    private config: LLMTelemetryConfig | null = null;
    private batchProcessor: BatchProcessor | null = null;
    private sessionManager: SessionManager | null = null;
    private appStateListener: AppStateListener | null = null;
    private evaluator: ResponseEvaluator | null = null;
    private sanitizer: Sanitizer | null = null;
    private mobileAttrs: MobileAttributeBuilder | null = null;
    private exporter: IExporter | null = null;
    private initialized = false;
    private activeSpans: Map<string, LLMSpan> = new Map();
    private _manualTraceDepth = 0;

    private constructor() { }

    /**
     * Get the singleton LLMTracer instance.
     */
    static getInstance(): LLMTracer {
        if (!LLMTracer.instance) {
            LLMTracer.instance = new LLMTracer();
        }
        return LLMTracer.instance;
    }

    /**
     * Reset the singleton (for testing).
     */
    static resetInstance(): void {
        if (LLMTracer.instance) {
            void LLMTracer.instance.shutdown().catch(() => { });
        }
        LLMTracer.instance = null;
    }

    /**
     * Initialize the tracer with configuration.
     * Must be called once at app startup before any instrumentation.
     */
    async init(config: LLMTelemetryConfig): Promise<void> {
        if (this.initialized) {
            console.warn('[LLMTelemetry] Tracer already initialized. Call shutdown() first to re-initialize.');
            return;
        }

        this.config = config;

        // Dev-mode config validation warnings
        this.validateConfig(config);

        // Bail out early if disabled
        if (config.enabled === false) {
            this.exporter = new NoopExporter();
            this.initialized = true;
            return;
        }

        // Initialize exporter
        try {
            this.exporter = createExporter(config);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[LLMTelemetry] Failed to create exporter:', msg);
            config.onError?.(msg, { phase: 'init', retryable: false });
            this.exporter = new NoopExporter();
        }

        // Initialize batch processor
        this.batchProcessor = new BatchProcessor(this.exporter, config);

        // Initialize session manager
        this.sessionManager = new SessionManager();
        await this.sessionManager.init().catch(() => {
            // Non-fatal — proceed without session persistence
        });

        // Initialize sanitizer
        this.sanitizer = new Sanitizer({
            maxPromptLength: config.maxPromptLength ?? 500,
            stripPII: config.stripPII ?? true,
        });

        // Initialize mobile attribute builder
        try {
            this.mobileAttrs = new MobileAttributeBuilder();
        } catch {
            this.mobileAttrs = null;
        }

        // Initialize evaluator
        this.evaluator = new ResponseEvaluator({
            enabled: config.evaluationEnabled ?? true,
            async: false,
            apiKey: config.evaluationApiKey,
            model: config.evaluationModel,
            endpoint: config.evaluationEndpoint,
        });

        // Set up AppState listener
        this.appStateListener = new AppStateListener(
            async () => {
                // On background: flush + persist session
                await this.flush();
                await this.sessionManager?.persistSession();
            },
            async () => {
                // On foreground: retry offline buffer
                await this.batchProcessor?.retryOfflineBuffer();
            }
        );
        this.appStateListener.start();

        this.initialized = true;
    }

    /**
     * Create and start a new span.
     */
    startSpan(name: string, options?: {
        parentSpanId?: string;
        traceId?: string;
        attributes?: Partial<LLMSpanAttributes>;
    }): LLMSpan {
        // Sample rate check
        const sampleRate = this.config?.sampleRate ?? 1.0;
        if (sampleRate < 1.0 && Math.random() > sampleRate) {
            // Return a no-op span that won't be exported
            const noopSpan = new LLMSpan(name, {
                traceId: options?.traceId,
                parentSpanId: options?.parentSpanId,
            });
            return noopSpan;
        }

        const span = new LLMSpan(name, {
            traceId: options?.traceId,
            parentSpanId: options?.parentSpanId,
            kind: SpanKind.CLIENT,
        });

        // Auto-attach mobile attributes
        if (this.mobileAttrs) {
            try {
                const mobileAttributes = this.mobileAttrs.getAttributes();
                span.setAttributes(mobileAttributes);
            } catch {
                // Non-fatal
            }
        }

        // Auto-attach session ID
        if (this.sessionManager) {
            span.setAttribute('session.id', this.sessionManager.getCurrentSessionId());
            span.setAttribute('session.message_count', this.sessionManager.getMessageCount());
        }

        // Apply provided attributes
        if (options?.attributes) {
            span.setAttributes(options.attributes);
        }

        // Track active span
        this.activeSpans.set(span.spanId, span);

        // Auto-attach global attributes
        if (this.config?.globalAttributes) {
            for (const [key, value] of Object.entries(this.config.globalAttributes)) {
                span.setAttribute(key, value);
            }
        }

        return span;
    }

    /**
     * End a span and queue it for export.
     * Optionally triggers evaluation if the span has LLM response data.
     */
    endSpan(span: LLMSpan): void {
        try {
            // Remove from active spans
            this.activeSpans.delete(span.spanId);

            // Update session message count
            if (this.sessionManager) {
                this.sessionManager.incrementMessageCount();
            }

            // Check if evaluation should trigger for this span
            if (this.evaluator && this.config?.evaluationEnabled !== false) {
                const response = span.getAttribute('llm.response') as string | undefined;
                const query = span.getAttribute('rag.query') as string | undefined
                    ?? span.getAttribute('llm.prompt') as string | undefined;

                if (response && query) {
                    const docs = span.getAttribute('rag.documents') as string | undefined;
                    const retrievedDocuments = docs ? JSON.parse(docs) as string[] : undefined;

                    // Evaluate, then end span, then export — single sequential flow.
                    // The span is NOT ended before evaluation so scores land on it.
                    // SAFETY: span is always added to batch processor even if eval throws.
                    void (async () => {
                        try {
                            await this.evaluator!.evaluate(
                                { query, response, retrievedDocuments },
                                span
                            );
                        } catch (evalErr) {
                            // Eval failed — continue without scores
                            const msg = evalErr instanceof Error ? evalErr.message : 'Evaluation failed';
                            this.config?.onError?.(msg, { phase: 'evaluation', retryable: false });
                        }
                        if (!span.ended) span.end();
                        this.batchProcessor?.add(span);
                    })();
                    return;
                }
            }

            // No evaluation path — end and export immediately
            if (!span.ended) {
                span.end();
            }
            this.batchProcessor?.add(span);
        } catch {
            // Never throw from telemetry — but ensure span still gets queued
            try {
                if (!span.ended) span.end();
                this.batchProcessor?.add(span);
            } catch {
                // Truly fatal — nothing we can do
            }
        }
    }

    /**
     * Start a new trace with a root span.
     * Returns a TraceHandle with the traceparent header for injection.
     */
    startTrace(name: string): TraceHandle {
        const traceId = generateTraceId();
        const span = this.startSpan(name, { traceId });

        return {
            traceId,
            spanId: span.spanId,
            traceparent: buildTraceparent(traceId, span.spanId, true),
            startTime: nowMs(),
        };
    }

    /**
     * End a trace by its handle with additional metadata.
     */
    endTrace(handle: TraceHandle, metadata?: Partial<LLMSpanAttributes>): void {
        const span = this.activeSpans.get(handle.spanId);
        if (!span) return;

        // Set latency
        const latencyMs = nowMs() - handle.startTime;
        span.setAttribute('llm.latency_ms', Math.round(latencyMs));

        // Set additional metadata
        if (metadata) {
            span.setAttributes(metadata);
        }

        this.endSpan(span);
    }

    /**
     * Force flush all pending spans.
     */
    async flush(): Promise<void> {
        try {
            await this.batchProcessor?.flush();
        } catch {
            // Never throw
        }
    }

    /**
     * Shutdown the tracer — flush + cleanup.
     */
    async shutdown(): Promise<void> {
        try {
            this.appStateListener?.stop();
            await this.batchProcessor?.shutdown();
            await this.exporter?.shutdown();
            await this.sessionManager?.persistSession();
            this.initialized = false;
            this.activeSpans.clear();
        } catch {
            // Never throw
        }
    }

    /**
     * Get the sanitizer instance.
     */
    getSanitizer(): Sanitizer | null {
        return this.sanitizer;
    }

    // ─── Manual Trace Coordination ─────────────────────────
    // Used by traceLLM() / fetch interceptor to prevent double-tracing.

    /**
     * Returns true when a traceLLM() span is currently in flight.
     * The fetch interceptor checks this to skip creating a duplicate span.
     */
    isTracingActive(): boolean {
        return this._manualTraceDepth > 0;
    }

    /** @internal Called by traceLLM() before executing fn(). */
    enterManualTrace(): void {
        this._manualTraceDepth++;
    }

    /** @internal Called by traceLLM() after fn() resolves or rejects. */
    exitManualTrace(): void {
        this._manualTraceDepth = Math.max(0, this._manualTraceDepth - 1);
    }

    /**
     * Get the evaluator instance.
     */
    getEvaluator(): ResponseEvaluator | null {
        return this.evaluator;
    }

    /**
     * Get the batch processor instance.
     */
    getBatchProcessor(): BatchProcessor | null {
        return this.batchProcessor;
    }

    /**
     * Get the session manager instance.
     */
    getSessionManager(): SessionManager | null {
        return this.sessionManager;
    }

    /**
     * Check if the tracer is initialized.
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Get the active config.
     */
    getConfig(): LLMTelemetryConfig | null {
        return this.config;
    }

    // ─── Config Validation ─────────────────────────────────────

    /**
     * Validate config and emit dev-mode warnings for common misconfigurations.
     * @internal
     */
    private validateConfig(config: LLMTelemetryConfig): void {
        try {
            const warn = (msg: string) => console.warn(`[LLMTelemetry] ⚠️ ${msg}`);

            // Loki exporter without lokiUrl
            if ((config.exporterType === 'loki' || config.exporterType === 'multi') && !config.lokiUrl) {
                warn('exporterType includes Loki but no "lokiUrl" was provided. Loki export will fail.');
            }

            // OTLP/Datadog/Honeycomb without collectorUrl
            const needsCollector = ['otlp-http', 'otlp-grpc', 'datadog', 'honeycomb', 'supabase'];
            if (needsCollector.includes(config.exporterType) && !config.collectorUrl) {
                warn(`exporterType "${config.exporterType}" requires a "collectorUrl" but none was provided.`);
            }

            // Evaluation enabled without API key
            if (config.evaluationEnabled !== false && !config.evaluationApiKey) {
                warn('Evaluation is enabled but "evaluationApiKey" is not set. LLM-as-judge grading will be skipped.');
            }

            // Invalid sample rate
            if (config.sampleRate !== undefined && (config.sampleRate < 0 || config.sampleRate > 1)) {
                warn(`sampleRate ${config.sampleRate} is outside the valid range [0, 1]. Defaulting to 1.0.`);
            }

            // Multi exporter without specifying backends
            if (config.exporterType === 'multi' && !config.multiExporters) {
                warn('exporterType "multi" used without "multiExporters". Defaulting to ["console", "loki"].');
            }
        } catch {
            // Never crash from validation
        }
    }
}
