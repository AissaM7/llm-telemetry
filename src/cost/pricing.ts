// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — LLM Cost Pricing
// ═══════════════════════════════════════════════════════════════════
// Computes USD cost per conversation turn from token counts.
// Pricing constants live here so they're easy to update.

export interface CostResult {
    prompt_usd: number;
    completion_usd: number;
    total_usd: number;
    model: string;
    currency: 'USD';
}

interface ModelPricing {
    /** USD per 1M input tokens */
    input: number;
    /** USD per 1M output tokens */
    output: number;
}

/**
 * Pricing map — USD per 1 million tokens.
 * Source: official provider pricing pages as of 2025.
 */
const PRICING_MAP: Record<string, ModelPricing> = {
    // OpenAI — GPT-4o family
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-2024-08-06': { input: 2.50, output: 10.00 },
    'gpt-4o-2024-11-20': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.60 },

    // OpenAI — GPT-4.1 family
    'gpt-4.1': { input: 2.00, output: 8.00 },
    'gpt-4.1-mini': { input: 0.40, output: 1.60 },
    'gpt-4.1-nano': { input: 0.10, output: 0.40 },

    // OpenAI — GPT-4 Turbo
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4-turbo-2024-04-09': { input: 10.00, output: 30.00 },

    // OpenAI — o-series reasoning models
    'o4-mini': { input: 1.10, output: 4.40 },
    'o3-mini': { input: 1.10, output: 4.40 },

    // Anthropic — Claude 4 / 3.7 / 3.5
    'claude-4-sonnet': { input: 3.00, output: 15.00 },
    'claude-3.7-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
    'claude-3-5-haiku': { input: 0.80, output: 4.00 },
    'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },

    // Google — Gemini 2.5
    'gemini-2.5-pro': { input: 1.25, output: 10.00 },
    'gemini-2.5-flash': { input: 0.15, output: 0.60 },
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },

    // Fallback
    'unknown': { input: 2.50, output: 10.00 },
};

/**
 * Compute the USD cost for a set of token counts and a model.
 * If the model is unrecognized, falls back to `unknown` pricing
 * and logs a warning in development.
 */
export function computeCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
): CostResult {
    let pricing = PRICING_MAP[model];

    if (!pricing) {
        // Strip versioned date suffix e.g. -2024-08-06
        const base = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
        if (PRICING_MAP[base]) {
            pricing = PRICING_MAP[base];
        } else {
            // Try prefix match as last resort
            const key = Object.keys(PRICING_MAP).find(k => model.startsWith(k));
            pricing = key ? PRICING_MAP[key] : PRICING_MAP['unknown'];
        }

        if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn(`[Pricing] Unknown model "${model}" — using fallback pricing`);
        }
    }

    const prompt_usd = (promptTokens / 1_000_000) * pricing.input;
    const completion_usd = (completionTokens / 1_000_000) * pricing.output;

    return {
        prompt_usd: Number(prompt_usd.toFixed(6)),
        completion_usd: Number(completion_usd.toFixed(6)),
        total_usd: Number((prompt_usd + completion_usd).toFixed(6)),
        model,
        currency: 'USD',
    };
}

/**
 * Get the pricing entry for a model. Exported for testing.
 */
export function getPricing(model: string): ModelPricing | undefined {
    return PRICING_MAP[model];
}
