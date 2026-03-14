// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — LLMSpan
// ═══════════════════════════════════════════════════════════════════
// Core span class with attribute setters, lifecycle management,
// and OTLP serialization.

import { generateTraceId, generateSpanId } from './id';
import { getUnixNs } from './clock';
import type {
    AttributeValue,
    LLMSpanAttributes,
    OTLPSpan,
    KeyValue,
    AnyValue,
    SpanEvent,
    SpanStatus,
} from '../types';
import { SpanKind, SpanStatusCode } from '../types';

/**
 * Convert an AttributeValue to an OTLP AnyValue.
 */
function toAnyValue(value: AttributeValue): AnyValue {
    if (typeof value === 'string') {
        return { stringValue: value };
    }
    if (typeof value === 'boolean') {
        return { boolValue: value };
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return { intValue: String(value) };
        }
        return { doubleValue: value };
    }
    if (Array.isArray(value)) {
        return {
            arrayValue: {
                values: value.map((v) => toAnyValue(v as AttributeValue)),
            },
        };
    }
    return { stringValue: String(value) };
}

/**
 * Convert a Map of attributes to OTLP KeyValue array.
 */
function mapToKeyValues(map: Map<string, AttributeValue>): KeyValue[] {
    const result: KeyValue[] = [];
    map.forEach((value, key) => {
        result.push({ key, value: toAnyValue(value) });
    });
    return result;
}

export interface LLMSpanOptions {
    parentSpanId?: string;
    traceId?: string;
    kind?: SpanKind;
}

/**
 * Represents a single instrumented operation (LLM call, RAG stage, etc.).
 * Enriched with LLM-specific attributes and serializable to OTLP JSON format.
 */
export class LLMSpan {
    private readonly _traceId: string;
    private readonly _spanId: string;
    private readonly _parentSpanId?: string;
    private readonly _name: string;
    private readonly _startTimeUnixNano: string;
    private _endTimeUnixNano?: string;
    private readonly _attributes: Map<string, AttributeValue>;
    private readonly _events: SpanEvent[];
    private _status: SpanStatus;
    private readonly _kind: SpanKind;
    private _ended: boolean;

    constructor(name: string, options?: LLMSpanOptions) {
        this._name = name;
        this._traceId = options?.traceId ?? generateTraceId();
        this._spanId = generateSpanId();
        this._parentSpanId = options?.parentSpanId;
        this._kind = options?.kind ?? SpanKind.INTERNAL;
        this._startTimeUnixNano = getUnixNs();
        this._attributes = new Map();
        this._events = [];
        this._status = { code: SpanStatusCode.UNSET };
        this._ended = false;
    }

    // ─── Getters ────────────────────────────────────────────────

    get traceId(): string { return this._traceId; }
    get spanId(): string { return this._spanId; }
    get parentSpanId(): string | undefined { return this._parentSpanId; }
    get name(): string { return this._name; }
    get startTimeUnixNano(): string { return this._startTimeUnixNano; }
    get endTimeUnixNano(): string | undefined { return this._endTimeUnixNano; }
    get events(): ReadonlyArray<SpanEvent> { return this._events; }
    get status(): Readonly<SpanStatus> { return this._status; }
    get kind(): SpanKind { return this._kind; }
    get ended(): boolean { return this._ended; }

    // ─── Attribute Methods ──────────────────────────────────────

    /**
     * Set a single attribute on this span. Chainable.
     * No-op after the span has ended.
     */
    setAttribute(key: string, value: AttributeValue): this {
        if (this._ended) { return this; }
        this._attributes.set(key, value);
        return this;
    }

    /**
     * Set multiple attributes from a partial LLMSpanAttributes object. Chainable.
     */
    setAttributes(attrs: Partial<LLMSpanAttributes>): this {
        if (this._ended) { return this; }
        for (const [key, value] of Object.entries(attrs)) {
            if (value !== undefined && value !== null) {
                this._attributes.set(key, value as AttributeValue);
            }
        }
        return this;
    }

    /**
     * Get an attribute value by key.
     */
    getAttribute(key: string): AttributeValue | undefined {
        return this._attributes.get(key);
    }

    // ─── Events ─────────────────────────────────────────────────

    /**
     * Add a timestamped event to this span. Chainable.
     */
    addEvent(name: string, attrs?: Record<string, AttributeValue>): this {
        if (this._ended) { return this; }
        const eventAttrs: KeyValue[] = [];
        if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
                eventAttrs.push({ key, value: toAnyValue(value) });
            }
        }
        this._events.push({
            name,
            timeUnixNano: getUnixNs(),
            attributes: eventAttrs,
        });
        return this;
    }

    // ─── Status ─────────────────────────────────────────────────

    /**
     * Set the span status. Chainable.
     */
    setStatus(code: 'OK' | 'ERROR', message?: string): this {
        if (this._ended) { return this; }
        this._status = {
            code: code === 'OK' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
            message,
        };
        return this;
    }

    /**
     * Record an exception as a span event with standard exception attributes.
     */
    recordException(error: Error): this {
        if (this._ended) { return this; }
        this.addEvent('exception', {
            'exception.type': error.name || 'Error',
            'exception.message': error.message || 'Unknown error',
            'exception.stacktrace': error.stack || '',
        });
        this.setStatus('ERROR', error.message);
        return this;
    }

    // ─── Lifecycle ──────────────────────────────────────────────

    /**
     * End this span. Sets endTimeUnixNano and prevents further attribute setting.
     */
    end(): void {
        if (this._ended) { return; }
        this._endTimeUnixNano = getUnixNs();
        this._ended = true;
    }

    /**
     * Calculate duration in milliseconds.
     * Returns 0 if span is not yet ended.
     */
    getDurationMs(): number {
        if (!this._endTimeUnixNano) { return 0; }
        const startNs = BigInt(this._startTimeUnixNano);
        const endNs = BigInt(this._endTimeUnixNano);
        const durationNs = endNs - startNs;
        return Number(durationNs / BigInt(1_000_000));
    }

    // ─── OTLP Serialization ────────────────────────────────────

    /**
     * Serialize this span to OTLP JSON format.
     */
    toOTLP(): OTLPSpan {
        const otlpSpan: OTLPSpan = {
            traceId: this._traceId,
            spanId: this._spanId,
            name: this._name,
            kind: this._kind,
            startTimeUnixNano: this._startTimeUnixNano,
            endTimeUnixNano: this._endTimeUnixNano ?? getUnixNs(),
            attributes: mapToKeyValues(this._attributes),
            status: {
                code: this._status.code,
                message: this._status.message,
            },
            events: this._events.length > 0 ? [...this._events] : undefined,
        };

        if (this._parentSpanId) {
            otlpSpan.parentSpanId = this._parentSpanId;
        }

        return otlpSpan;
    }
}
