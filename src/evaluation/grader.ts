// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — LLM-as-Judge Grader
// ═══════════════════════════════════════════════════════════════════
// Calls any OpenAI-compatible chat endpoint to grade LLM responses.
// Supports custom endpoints (Together AI, Ollama, etc.)

import type { EvaluationParams, EvaluationResult } from '../types';
import { EVALUATION_SYSTEM_PROMPT, buildEvaluationPrompt, JSON_RETRY_PROMPT } from './prompts';

interface GraderConfig {
    apiKey: string;
    model?: string;
    endpoint?: string;
    timeoutMs?: number;
}

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Validate that a parsed JSON object contains all required evaluation fields
 * and that all scores are within the 0-1 range.
 */
function validateEvaluationResult(obj: Record<string, unknown>): boolean {
    const requiredFields = ['correctness', 'hallucination', 'relevance', 'helpfulness', 'coherence', 'grounding', 'reasoning'];

    for (const field of requiredFields) {
        if (!(field in obj)) return false;
    }

    const scoreFields = ['correctness', 'hallucination', 'relevance', 'helpfulness', 'coherence', 'grounding'];
    for (const field of scoreFields) {
        const value = obj[field];
        if (typeof value !== 'number' || value < 0 || value > 1) return false;
    }

    if (typeof obj['reasoning'] !== 'string') return false;

    return true;
}

/**
 * Parse the grader's response into an EvaluationResult.
 */
function parseGraderResponse(content: string, model: string): EvaluationResult | null {
    try {
        // Try to extract JSON from the response (handle markdown code blocks)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) jsonStr = match[1].trim();
        }

        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

        if (!validateEvaluationResult(parsed)) {
            return null;
        }

        return {
            correctness: parsed['correctness'] as number,
            hallucination: parsed['hallucination'] as number,
            relevance: parsed['relevance'] as number,
            helpfulness: parsed['helpfulness'] as number,
            coherence: parsed['coherence'] as number,
            grounding: parsed['grounding'] as number,
            reasoning: parsed['reasoning'] as string,
            gradedAt: new Date().toISOString(),
            graderModel: model,
        };
    } catch {
        return null;
    }
}

/**
 * Grade an LLM response using an LLM-as-judge approach.
 * Calls any OpenAI-compatible chat completion endpoint.
 *
 * @returns EvaluationResult or null on failure (never throws)
 */
export async function gradeResponse(
    params: EvaluationParams,
    config: GraderConfig
): Promise<EvaluationResult | null> {
    const model = config.model ?? params.model ?? DEFAULT_MODEL;
    const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const userPrompt = buildEvaluationPrompt(params);

    const messages = [
        { role: 'system', content: EVALUATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
    ];

    // First attempt
    try {
        const result = await callGrader(messages, model, endpoint, config.apiKey, timeoutMs);
        if (result) return result;
    } catch {
        return null;
    }

    // Retry with explicit JSON reminder
    try {
        messages.push(
            { role: 'assistant', content: 'I apologize for the formatting error.' },
            { role: 'user', content: JSON_RETRY_PROMPT }
        );
        return await callGrader(messages, model, endpoint, config.apiKey, timeoutMs);
    } catch {
        return null;
    }
}

/**
 * Make a single grader API call.
 */
async function callGrader(
    messages: Array<{ role: string; content: string }>,
    model: string,
    endpoint: string,
    apiKey: string,
    timeoutMs: number
): Promise<EvaluationResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'X-LLM-Telemetry-Internal': 'true',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0,
                max_tokens: 500,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return null;
        }

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };

        const content = data?.choices?.[0]?.message?.content;
        if (!content) return null;

        return parseGraderResponse(content, model);
    } catch {
        clearTimeout(timeout);
        return null;
    }
}
