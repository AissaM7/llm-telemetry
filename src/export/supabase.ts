// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Supabase Exporter
// ═══════════════════════════════════════════════════════════════════
// Ships enriched LLM traces to a Supabase Edge Function endpoint.
// Logs appear automatically in the Supabase dashboard.

import type { IExporter, ExportResult, OTLPSpanPayload, LLMTelemetryConfig, OTLPSpan } from '../types';
import { buildEnrichedLog } from './enriched-log';

const EXPORT_TIMEOUT_MS = 10_000;

/**
 * Supabase exporter — sends enriched trace logs to a Supabase
 * Edge Function (`telemetry-ingest`) via the project's REST API.
 * Logs are visible in Supabase Dashboard > Edge Functions > Logs.
 */
export class SupabaseExporter implements IExporter {
    private endpoint: string;
    private headers: Record<string, string>;
    private config: LLMTelemetryConfig;

    constructor(config: LLMTelemetryConfig) {
        const supabaseUrl = (config.collectorUrl || '').replace(/\/+$/, '');
        this.endpoint = `${supabaseUrl}/functions/v1/telemetry-ingest`;
        this.config = config;

        this.headers = {
            'Content-Type': 'application/json',
            ...config.headers,
        };

        // Use the Supabase anon key for auth
        if (config.apiKey) {
            this.headers['Authorization'] = `Bearer ${config.apiKey}`;
            this.headers['apikey'] = config.apiKey;
        }
    }

    async export(payload: OTLPSpanPayload): Promise<ExportResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

        try {
            // Collect all spans across all resource/scope groups
            const allSpans: OTLPSpan[] = [];
            for (const resourceSpan of payload.resourceSpans) {
                for (const scopeSpan of resourceSpan.scopeSpans) {
                    allSpans.push(...scopeSpan.spans);
                }
            }

            if (allSpans.length === 0) {
                clearTimeout(timeout);
                return { success: true, itemsExported: 0 };
            }

            // Group spans by traceId
            const traceGroups = new Map<string, OTLPSpan[]>();
            for (const span of allSpans) {
                const existing = traceGroups.get(span.traceId) ?? [];
                existing.push(span);
                traceGroups.set(span.traceId, existing);
            }

            // Build enriched logs for each trace
            const enrichedLogs = [...traceGroups.values()].map((traceSpans) =>
                buildEnrichedLog(traceSpans, this.config)
            );

            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(enrichedLogs),
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (response.ok) {
                return { success: true, itemsExported: allSpans.length };
            }

            if (response.status === 429) {
                return { success: false, error: 'Rate limited (429)', retryable: true };
            }

            if (response.status >= 500) {
                return { success: false, error: `Server error (${response.status})`, retryable: true };
            }

            return {
                success: false,
                error: `Supabase Edge Function error (${response.status})`,
                retryable: false,
            };
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
