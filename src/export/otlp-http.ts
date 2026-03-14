// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — OTLP/HTTP Exporter
// ═══════════════════════════════════════════════════════════════════
// Exports traces to any OTLP-compatible HTTP endpoint:
// Grafana Tempo, OpenTelemetry Collector, Grafana Agent, etc.

import type { IExporter, ExportResult, OTLPSpanPayload, LLMTelemetryConfig } from '../types';

const EXPORT_TIMEOUT_MS = 10_000;

/**
 * OTLP/HTTP JSON trace exporter.
 * Sends traces to Grafana Tempo, OpenTelemetry Collector, or any OTLP-compatible HTTP endpoint.
 */
export class OTLPHTTPExporter implements IExporter {
    private endpoint: string;
    private headers: Record<string, string>;

    constructor(config: LLMTelemetryConfig) {
        // Ensure endpoint ends with /v1/traces
        const baseUrl = (config.collectorUrl ?? 'http://localhost:4318').replace(/\/+$/, '');
        this.endpoint = baseUrl.endsWith('/v1/traces') ? baseUrl : `${baseUrl}/v1/traces`;

        this.headers = {
            'Content-Type': 'application/json',
            ...config.headers,
        };

        if (config.apiKey) {
            this.headers['Authorization'] = `Bearer ${config.apiKey}`;
        }
    }

    async export(payload: OTLPSpanPayload): Promise<ExportResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

        try {
            const body = JSON.stringify(payload);

            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: this.headers,
                body,
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (response.status === 200 || response.status === 204) {
                const spanCount = payload.resourceSpans.reduce((total, rs) => {
                    return total + rs.scopeSpans.reduce((st, ss) => st + ss.spans.length, 0);
                }, 0);
                return { success: true, itemsExported: spanCount };
            }

            if (response.status === 429) {
                return { success: false, error: 'Rate limited (429)', retryable: true };
            }

            if (response.status >= 500) {
                return { success: false, error: `Server error (${response.status})`, retryable: true };
            }

            return { success: false, error: `Client error (${response.status})`, retryable: false };
        } catch (err) {
            clearTimeout(timeout);
            const message = err instanceof Error ? err.message : 'Unknown network error';
            return { success: false, error: message, retryable: true };
        }
    }

    async shutdown(): Promise<void> {
        // No persistent connections to clean up
    }
}
