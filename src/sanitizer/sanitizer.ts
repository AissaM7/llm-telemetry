// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — PII Sanitizer
// ═══════════════════════════════════════════════════════════════════
// Scrubs PII patterns and truncates prompts before export.

export interface SanitizerConfig {
    /** Maximum prompt length in characters. Default: 500 */
    maxPromptLength: number;
    /** Whether to strip PII patterns. Default: true */
    stripPII: boolean;
    /** Additional custom PII patterns to strip */
    stripPIIPatterns?: RegExp[];
}

const DEFAULT_CONFIG: SanitizerConfig = {
    maxPromptLength: 500,
    stripPII: true,
};

// Built-in PII patterns
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
    // Email addresses
    { pattern: /[\w.-]+@[\w.-]+\.\w+/g, replacement: '[email]' },
    // Phone numbers (US/international)
    { pattern: /(\+?1?\s?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, replacement: '[phone]' },
    // Credit card numbers (with optional separators)
    { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[card]' },
    // SSN
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[ssn]' },
    // API keys (known prefixes: OpenAI sk-, Stripe pk_/sk_, AWS AKIA, Anthropic sk-ant-)
    { pattern: /\b(sk-[A-Za-z0-9]{20,}|pk_[A-Za-z0-9]{20,}|sk_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16,}|sk-ant-[A-Za-z0-9-]{20,}|xai-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,})\b/g, replacement: '[key]' },
    // Bearer tokens in text
    { pattern: /Bearer\s+[A-Za-z0-9._-]+/gi, replacement: 'Bearer [token]' },
];

/**
 * Sanitizer for privacy-safe telemetry data export.
 * Strips PII and truncates text to configurable limits.
 */
export class Sanitizer {
    private config: SanitizerConfig;
    private allPatterns: Array<{ pattern: RegExp; replacement: string }>;

    constructor(config?: Partial<SanitizerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.allPatterns = [...PII_PATTERNS];

        if (config?.stripPIIPatterns) {
            for (const pattern of config.stripPIIPatterns) {
                this.allPatterns.push({ pattern, replacement: '[redacted]' });
            }
        }
    }

    /**
     * Sanitize text by removing PII and truncating.
     */
    sanitize(text: string): string {
        if (!text) return '';

        let result = text;

        // Step 1: Strip PII if enabled
        if (this.config.stripPII) {
            result = this.removePII(result);
        }

        // Step 2: Truncate to max length
        if (result.length > this.config.maxPromptLength) {
            result = result.substring(0, this.config.maxPromptLength) + '...[truncated]';
        }

        return result;
    }

    /**
     * Remove PII patterns from text.
     */
    private removePII(text: string): string {
        let result = text;
        for (const { pattern, replacement } of this.allPatterns) {
            // Reset regex state for global patterns
            const regex = new RegExp(pattern.source, pattern.flags);
            result = result.replace(regex, replacement);
        }
        return result;
    }

    /**
     * Compute a simple non-crypto hash for system prompt change detection.
     * Uses the djb2 algorithm — fast, no crypto dependency needed.
     * Returns an 8-character hex string.
     */
    hashString(text: string): string {
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0; // hash * 33 + c
        }
        // Convert to unsigned 32-bit then to 8-char hex
        return (hash >>> 0).toString(16).padStart(8, '0');
    }
}
