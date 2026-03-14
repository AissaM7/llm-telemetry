// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Rule-Based Hallucination Pre-Scorer
// ═══════════════════════════════════════════════════════════════════
// Fast, rule-based hallucination detection that runs before LLM grading.
// No API calls needed — purely string-based analysis.

// Common English stopwords to skip during token matching
const STOPWORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
    'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
    'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
    'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no',
    'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
    'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
    'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
    'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
    'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
    'give', 'day', 'most', 'us', 'are', 'was', 'were', 'been', 'has',
    'had', 'did', 'does', 'may', 'might', 'must', 'should', 'very',
    'more', 'here', 'still', 'such', 'many', 'both', 'each', 'much',
]);

/**
 * Tokenize text into significant words (>4 chars, not stopwords).
 */
function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 4 && !STOPWORDS.has(word));
}

/**
 * Compute a grounding score by checking how many significant tokens
 * in the response appear in the retrieved documents.
 *
 * @returns Score from 0-1 where 1 = fully grounded, 0 = no grounding
 */
export function computeGroundingScore(
    response: string,
    retrievedDocuments: string[]
): number {
    if (!response || retrievedDocuments.length === 0) return 0;

    const responseTokens = tokenize(response);
    if (responseTokens.length === 0) return 1; // Empty response = no claims = no hallucination

    const documentText = retrievedDocuments.join(' ').toLowerCase();
    let matchedCount = 0;

    for (const token of responseTokens) {
        if (documentText.includes(token)) {
            matchedCount++;
        }
    }

    return matchedCount / responseTokens.length;
}

/**
 * Extract phrases that look like specific factual claims:
 * - Numbers/dates/times
 * - Proper nouns (capitalized words not at sentence start)
 * - Quoted text
 */
export function extractSpecificClaims(text: string): string[] {
    const claims: string[] = [];

    // Numbers, dates, times, prices
    const numberPatterns = /(?:\$?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:am|pm|%|dollars?|cents?|miles?|km|hours?|minutes?|seconds?))?)/gi;
    const numberMatches = text.match(numberPatterns);
    if (numberMatches) claims.push(...numberMatches);

    // Date-like patterns
    const datePatterns = /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?)/gi;
    const dateMatches = text.match(datePatterns);
    if (dateMatches) claims.push(...dateMatches);

    // Time patterns
    const timePatterns = /\b\d{1,2}:\d{2}(?:\s*(?:am|pm))?\b/gi;
    const timeMatches = text.match(timePatterns);
    if (timeMatches) claims.push(...timeMatches);

    // Proper nouns (capitalized words mid-sentence, excluding sentence starters)
    const sentences = text.split(/[.!?]\s+/);
    for (const sentence of sentences) {
        const words = sentence.split(/\s+/);
        for (let i = 1; i < words.length; i++) {
            const word = words[i].replace(/[^a-zA-Z']/g, '');
            if (word.length > 2 && /^[A-Z]/.test(word) && !STOPWORDS.has(word.toLowerCase())) {
                claims.push(word);
            }
        }
    }

    // Quoted text
    const quotedText = text.match(/"([^"]+)"|'([^']+)'/g);
    if (quotedText) {
        claims.push(...quotedText.map((q) => q.replace(/['"]/g, '')));
    }

    return [...new Set(claims)]; // Deduplicate
}

/**
 * Check which claims are grounded in the provided context.
 */
export function claimsGroundedInContext(
    claims: string[],
    context: string
): { grounded: string[]; ungrounded: string[] } {
    const contextLower = context.toLowerCase();
    const grounded: string[] = [];
    const ungrounded: string[] = [];

    for (const claim of claims) {
        const claimLower = claim.toLowerCase().trim();
        if (claimLower.length < 2) continue;

        if (contextLower.includes(claimLower)) {
            grounded.push(claim);
        } else {
            // Try fuzzy match — check if individual significant words appear
            const words = claimLower.split(/\s+/).filter((w) => w.length > 3);
            const matchedWords = words.filter((w) => contextLower.includes(w));

            if (words.length > 0 && matchedWords.length / words.length >= 0.5) {
                grounded.push(claim);
            } else {
                ungrounded.push(claim);
            }
        }
    }

    return { grounded, ungrounded };
}

/**
 * Quick hallucination score combining token overlap and claim grounding.
 * Returns a 0-1 score where higher = more likely hallucinated.
 *
 * This is a fast pre-check before expensive LLM grading.
 */
export function quickHallucinationScore(
    response: string,
    documents: string[]
): number {
    if (!response || documents.length === 0) return 0.5; // Unknown

    // Token overlap approach
    const groundingScore = computeGroundingScore(response, documents);

    // Claim-based approach
    const context = documents.join(' ');
    const claims = extractSpecificClaims(response);

    let claimScore = 0;
    if (claims.length > 0) {
        const { ungrounded } = claimsGroundedInContext(claims, context);
        claimScore = ungrounded.length / claims.length;
    }

    // Weighted combination: 60% token overlap, 40% claim grounding
    const hallucinationRisk = (1 - groundingScore) * 0.6 + claimScore * 0.4;

    return Math.min(1, Math.max(0, hallucinationRisk));
}
