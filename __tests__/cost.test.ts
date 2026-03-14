// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Cost Pricing Tests
// ═══════════════════════════════════════════════════════════════════

// Mock __DEV__ for warning tests
(globalThis as Record<string, unknown>).__DEV__ = true;

import { computeCost, getPricing } from '../src/cost/pricing';

describe('computeCost', () => {
    it('computes correct USD for gpt-4o with known token counts', () => {
        // gpt-4o pricing: $2.50/1M input, $10.00/1M output
        const result = computeCost('gpt-4o-2024-08-06', 1737, 136);

        // prompt: 1737 / 1_000_000 * 2.50 = 0.0043425
        expect(result.prompt_usd).toBeCloseTo(0.004343, 5);

        // completion: 136 / 1_000_000 * 10.00 = 0.00136
        expect(result.completion_usd).toBeCloseTo(0.00136, 5);

        // total: 0.0043425 + 0.00136 = 0.0057025
        expect(result.total_usd).toBeCloseTo(0.005703, 5);

        expect(result.model).toBe('gpt-4o-2024-08-06');
        expect(result.currency).toBe('USD');
    });

    it('computes correct USD for gpt-4o-mini', () => {
        // gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output
        const result = computeCost('gpt-4o-mini', 10000, 5000);

        expect(result.prompt_usd).toBeCloseTo(0.0015, 5);
        expect(result.completion_usd).toBeCloseTo(0.003, 5);
        expect(result.total_usd).toBeCloseTo(0.0045, 5);
    });

    it('returns zero cost for zero tokens', () => {
        const result = computeCost('gpt-4o', 0, 0);
        expect(result.prompt_usd).toBe(0);
        expect(result.completion_usd).toBe(0);
        expect(result.total_usd).toBe(0);
    });

    it('uses unknown fallback for unrecognized model and logs warning', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        const result = computeCost('my-custom-llm-v9', 1000, 500);

        // Should use unknown fallback: $2.50/1M input, $10.00/1M output
        expect(result.prompt_usd).toBeCloseTo(0.0025, 5);
        expect(result.completion_usd).toBeCloseTo(0.005, 5);
        expect(result.model).toBe('my-custom-llm-v9');
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Unknown model')
        );

        warnSpy.mockRestore();
    });

    it('has pricing entries for all required models', () => {
        const requiredModels = [
            'gpt-4o',
            'gpt-4o-2024-08-06',
            'gpt-4o-mini',
            'gpt-4-turbo',
            'claude-3-5-sonnet',
            'claude-3-5-haiku',
            'unknown',
        ];

        for (const model of requiredModels) {
            const pricing = getPricing(model);
            expect(pricing).toBeDefined();
            expect(pricing!.input).toBeGreaterThan(0);
            expect(pricing!.output).toBeGreaterThan(0);
        }
    });
});
