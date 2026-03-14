// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — W3C Trace Context
// ═══════════════════════════════════════════════════════════════════
// Implements W3C Trace Context (traceparent / tracestate) header
// generation and parsing per https://www.w3.org/TR/trace-context/

const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const INVALID_TRACE_ID = '00000000000000000000000000000000';
const INVALID_SPAN_ID = '0000000000000000';

/**
 * Build a W3C traceparent header value.
 *
 * Format: "00-{traceId}-{spanId}-{flags}"
 * - Version: always "00"
 * - Flags: "01" if sampled, "00" if not
 *
 * @example
 * buildTraceparent('4bf92f3577b34da6a3ce929d0e0e4736', '00f067aa0ba902b7', true)
 * // => "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
 */
export function buildTraceparent(traceId: string, spanId: string, sampled: boolean = true): string {
    const flags = sampled ? '01' : '00';
    return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Parse a W3C traceparent header value.
 *
 * @returns Parsed trace context, or null if the header is malformed.
 */
export function parseTraceparent(header: string): {
    traceId: string;
    parentSpanId: string;
    sampled: boolean;
} | null {
    if (typeof header !== 'string') {
        return null;
    }

    const trimmed = header.trim().toLowerCase();
    const match = TRACEPARENT_REGEX.exec(trimmed);

    if (!match) {
        return null;
    }

    const [, version, traceId, parentSpanId, flags] = match;

    // Version must be "00" (current W3C spec)
    if (version !== '00') {
        return null;
    }

    // Trace ID must not be all zeros
    if (traceId === INVALID_TRACE_ID) {
        return null;
    }

    // Span ID must not be all zeros
    if (parentSpanId === INVALID_SPAN_ID) {
        return null;
    }

    const sampled = (parseInt(flags, 16) & 0x01) === 1;

    return { traceId, parentSpanId, sampled };
}

/**
 * Build a W3C tracestate header value from key-value pairs.
 *
 * Format: "key1=value1,key2=value2"
 */
export function buildTracestate(pairs: Record<string, string>): string {
    return Object.entries(pairs)
        .map(([key, value]) => `${key}=${value}`)
        .join(',');
}

/**
 * Get trace context headers for injection into outgoing fetch requests.
 * Returns both traceparent and tracestate headers.
 *
 * These headers enable trace correlation: mobile → backend → LLM
 */
export function getTraceHeaders(
    traceId: string,
    spanId: string,
    sampled: boolean = true
): Record<string, string> {
    return {
        traceparent: buildTraceparent(traceId, spanId, sampled),
        tracestate: buildTracestate({ 'llm-telemetry': `s:${spanId}` }),
    };
}
