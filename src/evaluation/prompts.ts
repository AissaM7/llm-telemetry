// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Evaluation Prompt Templates
// ═══════════════════════════════════════════════════════════════════

import type { EvaluationParams } from '../types';

/**
 * System prompt for the LLM-as-judge evaluator.
 */
export const EVALUATION_SYSTEM_PROMPT = `You are an expert LLM output quality evaluator.
You evaluate AI assistant responses on multiple quality dimensions.

SCORING RULES:
- All scores are between 0.0 and 1.0 (float, two decimal places)
- correctness: Did the AI accurately answer the user's question?
  1.0 = fully correct, 0.0 = completely wrong
- hallucination: Did the AI invent facts not present in the retrieved context?
  0.0 = no hallucination, 1.0 = severe hallucination
  NOTE: Higher hallucination score = worse quality
- relevance: Were the retrieved documents relevant to the query?
  1.0 = perfectly relevant, 0.0 = completely irrelevant
- helpfulness: Is the response actionable and useful to the user?
  1.0 = highly actionable, 0.0 = useless
- coherence: Is the response well-structured and easy to understand?
  1.0 = perfectly structured, 0.0 = incoherent
- grounding: Is every factual claim in the response supported by the retrieved context?
  1.0 = fully grounded, 0.0 = no grounding

You MUST respond ONLY with valid JSON matching this exact schema:
{
  "correctness": 0.00,
  "hallucination": 0.00,
  "relevance": 0.00,
  "helpfulness": 0.00,
  "coherence": 0.00,
  "grounding": 0.00,
  "reasoning": "brief explanation under 100 words"
}

No preamble. No markdown. Only the JSON object.`;

/**
 * Build the user-facing evaluation prompt with context filled in.
 */
export function buildEvaluationPrompt(params: EvaluationParams): string {
    const { query, response, retrievedDocuments, expectedAnswer } = params;

    let documentsText = 'No retrieved documents provided.';
    if (retrievedDocuments && retrievedDocuments.length > 0) {
        // Truncate total document text to 3000 chars to avoid huge prompts
        let totalLength = 0;
        const truncatedDocs: string[] = [];
        for (let i = 0; i < retrievedDocuments.length; i++) {
            const doc = retrievedDocuments[i];
            const remaining = 3000 - totalLength;
            if (remaining <= 0) {
                truncatedDocs.push(`${i + 1}. [truncated — ${retrievedDocuments.length - i} more documents]`);
                break;
            }
            const truncated = doc.length > remaining ? doc.substring(0, remaining) + '...' : doc;
            truncatedDocs.push(`${i + 1}. ${truncated}`);
            totalLength += truncated.length;
        }
        documentsText = truncatedDocs.join('\n');
    }

    let prompt = `## USER QUERY
${query}

## RETRIEVED DOCUMENTS
${documentsText}

## AI RESPONSE
${response}`;

    if (expectedAnswer) {
        prompt += `

## EXPECTED ANSWER (ground truth)
${expectedAnswer}`;
    }

    prompt += `

Evaluate the AI response against the scoring rubric. Return ONLY the JSON object.`;

    return prompt;
}

/**
 * Specialized hallucination detection prompt.
 * Focuses specifically on identifying fabricated facts.
 */
export const HALLUCINATION_CHECK_PROMPT = `You are a hallucination detection specialist.
Your job is to compare an AI response against the provided context and identify any fabricated facts.

TASK:
1. Read the context documents carefully
2. Read the AI response
3. Identify any claims in the response that are NOT supported by the context
4. Score the hallucination level

Return ONLY valid JSON:
{
  "hallucination_score": 0.00,
  "fabricated_claims": ["claim 1", "claim 2"],
  "reasoning": "brief explanation"
}

No preamble. No markdown. Only the JSON object.`;

/**
 * JSON retry prompt — sent when the grader's first response wasn't valid JSON.
 */
export const JSON_RETRY_PROMPT = `Your previous response was not valid JSON. 
Please respond ONLY with a valid JSON object matching this exact schema:
{
  "correctness": 0.00,
  "hallucination": 0.00,
  "relevance": 0.00,
  "helpfulness": 0.00,
  "coherence": 0.00,
  "grounding": 0.00,
  "reasoning": "brief explanation"
}

No preamble. No markdown. No explanation. Only the raw JSON object.`;
