// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Multi-Exporter
// ═══════════════════════════════════════════════════════════════════
// Fans out export calls to multiple exporters in parallel.

import type { IExporter, ExportResult, OTLPSpanPayload } from '../types';

/**
 * Wraps multiple exporters and sends data to all of them in parallel.
 * Succeeds if at least one exporter succeeds.
 */
export class MultiExporter implements IExporter {
    private exporters: IExporter[];

    constructor(exporters: IExporter[]) {
        this.exporters = exporters;
    }

    async export(payload: OTLPSpanPayload): Promise<ExportResult> {
        const results = await Promise.allSettled(
            this.exporters.map((e) => e.export(payload))
        );

        let totalExported = 0;
        let anySuccess = false;
        const errors: string[] = [];

        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.success) {
                anySuccess = true;
                totalExported = Math.max(totalExported, result.value.itemsExported ?? 0);
            } else if (result.status === 'fulfilled' && !result.value.success) {
                errors.push(result.value.error ?? 'Unknown error');
            } else if (result.status === 'rejected') {
                errors.push(String(result.reason));
            }
        }

        if (anySuccess) {
            return { success: true, itemsExported: totalExported };
        }

        return {
            success: false,
            error: errors.join('; '),
            retryable: true,
        };
    }

    async shutdown(): Promise<void> {
        await Promise.allSettled(this.exporters.map((e) => e.shutdown()));
    }
}
