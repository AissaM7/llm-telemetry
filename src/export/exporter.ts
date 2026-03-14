// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Exporter Interface & Factory
// ═══════════════════════════════════════════════════════════════════

import type { IExporter, LLMTelemetryConfig, ExportResult, OTLPSpanPayload } from '../types';

// Re-export for convenience
export type { IExporter, ExportResult };

/**
 * Creates an exporter instance based on the configured exporter type.
 */
export function createExporter(config: LLMTelemetryConfig): IExporter {
    switch (config.exporterType) {
        case 'otlp-http': {
            const { OTLPHTTPExporter } = require('./otlp-http') as { OTLPHTTPExporter: new (c: LLMTelemetryConfig) => IExporter };
            return new OTLPHTTPExporter(config);
        }
        case 'otlp-grpc': {
            const { OTLPGRPCExporter } = require('./otlp-grpc') as { OTLPGRPCExporter: new (c: LLMTelemetryConfig) => IExporter };
            return new OTLPGRPCExporter(config);
        }
        case 'datadog': {
            const { DatadogExporter } = require('./datadog') as { DatadogExporter: new (c: LLMTelemetryConfig) => IExporter };
            return new DatadogExporter(config);
        }
        case 'honeycomb': {
            const { HoneycombExporter } = require('./honeycomb') as { HoneycombExporter: new (c: LLMTelemetryConfig) => IExporter };
            return new HoneycombExporter(config);
        }
        case 'loki': {
            const { LokiExporter } = require('./loki') as { LokiExporter: new (c: LLMTelemetryConfig) => IExporter };
            return new LokiExporter(config);
        }
        case 'supabase': {
            const { SupabaseExporter } = require('./supabase') as { SupabaseExporter: new (c: LLMTelemetryConfig) => IExporter };
            return new SupabaseExporter(config);
        }
        case 'console': {
            const { ConsoleExporter } = require('./console') as { ConsoleExporter: new (c: LLMTelemetryConfig) => IExporter };
            return new ConsoleExporter(config);
        }
        case 'multi': {
            // Configurable multi-backend: defaults to ['console', 'loki'] if not specified
            const backends = config.multiExporters ?? ['console', 'loki'];
            const { MultiExporter } = require('./multi') as { MultiExporter: new (e: IExporter[]) => IExporter };
            const exporters: IExporter[] = [];

            for (const backend of backends) {
                try {
                    // Recursively create each sub-exporter
                    const subConfig = { ...config, exporterType: backend } as LLMTelemetryConfig;
                    exporters.push(createExporter(subConfig));
                } catch {
                    // Skip failing sub-exporters — don't let one bad backend kill the others
                }
            }

            if (exporters.length === 0) {
                // Fallback: at least console
                const { ConsoleExporter } = require('./console') as { ConsoleExporter: new (c: LLMTelemetryConfig) => IExporter };
                exporters.push(new ConsoleExporter(config));
            }

            return new MultiExporter(exporters);
        }
        default:
            throw new Error(
                `[LLMTelemetry] Invalid exporter type: "${config.exporterType}". ` +
                `Valid options: 'otlp-http', 'otlp-grpc', 'datadog', 'honeycomb', 'loki', 'supabase', 'console', 'multi'.`
            );
    }
}

/**
 * No-op exporter for when telemetry is disabled.
 */
export class NoopExporter implements IExporter {
    async export(_payload: OTLPSpanPayload): Promise<ExportResult> {
        return { success: true, itemsExported: 0 };
    }
    async shutdown(): Promise<void> {
        // No-op
    }
}
