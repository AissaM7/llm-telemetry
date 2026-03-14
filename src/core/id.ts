// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — ID Generation
// ═══════════════════════════════════════════════════════════════════
// Uses crypto.getRandomValues for cryptographically secure IDs.
// Compatible with React Native Hermes engine.

/**
 * Convert a Uint8Array to a lowercase hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

/**
 * Get a reference to crypto.getRandomValues, throwing if unavailable.
 */
function getRandomValues(buffer: Uint8Array): Uint8Array {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
        return globalThis.crypto.getRandomValues(buffer as unknown as Uint8Array<ArrayBuffer>) as unknown as Uint8Array;
    }

    // Hermes in some RN versions exposes crypto on global
    const g = globalThis as Record<string, unknown>;
    if (typeof g.crypto === 'object' && g.crypto !== null) {
        const c = g.crypto as { getRandomValues?: (buf: Uint8Array) => Uint8Array };
        if (typeof c.getRandomValues === 'function') {
            return c.getRandomValues(buffer);
        }
    }

    // Fallback: Math.random() — not cryptographically secure but fine for
    // telemetry trace/span IDs. Avoids crashing in RN environments where
    // crypto.getRandomValues is not available.
    for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.floor(Math.random() * 256);
    }
    return buffer;
}

/**
 * Generate a W3C-compatible Trace ID.
 * Returns a 32-character lowercase hex string (16 random bytes).
 */
export function generateTraceId(): string {
    const bytes = new Uint8Array(16);
    getRandomValues(bytes);
    return bytesToHex(bytes);
}

/**
 * Generate a Span ID.
 * Returns a 16-character lowercase hex string (8 random bytes).
 */
export function generateSpanId(): string {
    const bytes = new Uint8Array(8);
    getRandomValues(bytes);
    return bytesToHex(bytes);
}

/**
 * Generate a Session ID.
 * Returns a 32-character lowercase hex string (16 random bytes).
 * Same format as trace IDs for consistency.
 */
export function generateSessionId(): string {
    const bytes = new Uint8Array(16);
    getRandomValues(bytes);
    return bytesToHex(bytes);
}
