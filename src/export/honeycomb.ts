// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Honeycomb Exporter
// ═══════════════════════════════════════════════════════════════════
// Exports traces to Honeycomb via their OTLP endpoint.

import type { IExporter, ExportResult, OTLPSpanPayload, LLMTelemetryConfig } from '../types';

const EXPORT_TIMEOUT_MS = 10_000;
const HONEYCOMB_ENDPOINT = 'https://api.honeycomb.io/v1/traces';

/**
 * Honeycomb OTLP exporter.
 * Sends standard OTLP JSON payloads with Honeycomb-specific headers.
 */
export class HoneycombExporter implements IExporter {
    private endpoint: string;
    private headers: Record<string, string>;

    constructor(config: LLMTelemetryConfig) {
        this.endpoint = config.collectorUrl
            ? `${config.collectorUrl.replace(/\/+$/, '')}/v1/traces`
            : HONEYCOMB_ENDPOINT;

        const dataset = config.appId || 'llm-traces';

        this.headers = {
            'Content-Type': 'application/json',
            'x-honeycomb-dataset': dataset,
            ...config.headers,
        };

        if (config.apiKey) {
            this.headers['x-honeycomb-team'] = config.apiKey;
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

            if (response.status === 200 || response.status === 202 || response.status === 204) {
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
        // No persistent connections
    }
}
