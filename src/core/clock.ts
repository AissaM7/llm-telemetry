// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — High Resolution Clock
// ═══════════════════════════════════════════════════════════════════
// Provides high-resolution timing compatible with OTLP nanosecond
// timestamps. Uses performance.now() for sub-millisecond precision.

/**
 * Get current time in milliseconds using performance.now().
 * Falls back to Date.now() if performance API is unavailable.
 */
export function nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

/**
 * Get current time in nanoseconds as a BigInt.
 * Combines Date.now() for epoch alignment with performance.now() for sub-ms precision.
 */
export function nowNs(): bigint {
    const epochMs = BigInt(Date.now());
    const perfMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : 0;
    const subMs = BigInt(Math.round((perfMs % 1) * 1_000_000));
    return epochMs * BigInt(1_000_000) + subMs;
}

/**
 * Convert milliseconds to a nanosecond string for OTLP payloads.
 */
export function msToNs(ms: number): string {
    const wholePart = BigInt(Math.floor(ms));
    const fracPart = BigInt(Math.round((ms % 1) * 1_000_000));
    return String(wholePart * BigInt(1_000_000) + fracPart);
}

/**
 * Get current Unix time as nanosecond string for OTLP payloads.
 * OTLP requires startTimeUnixNano and endTimeUnixNano as strings
 * representing nanoseconds since Unix epoch.
 */
export function getUnixNs(): string {
    const epochMs = BigInt(Date.now());
    const perfMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : 0;
    const subMs = BigInt(Math.round((perfMs % 1) * 1_000_000));
    return String(epochMs * BigInt(1_000_000) + subMs);
}
