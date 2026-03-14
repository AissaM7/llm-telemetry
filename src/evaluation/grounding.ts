// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Retrieval Grounding Overlap Scorer
// ═══════════════════════════════════════════════════════════════════
// Re-exports grounding functions from hallucination module for
// a clean API surface.

export {
    computeGroundingScore,
    extractSpecificClaims,
    claimsGroundedInContext,
} from './hallucination';

/**
 * Compute a detailed grounding analysis for a response against retrieved documents.
 */
export function analyzeGrounding(
    response: string,
    documents: string[]
): {
    score: number;
    totalClaims: number;
    groundedClaims: number;
    ungroundedClaims: string[];
} {
    // Import from hallucination module
    const { extractSpecificClaims, claimsGroundedInContext, computeGroundingScore } = require('./hallucination') as {
        extractSpecificClaims: (text: string) => string[];
        claimsGroundedInContext: (claims: string[], context: string) => { grounded: string[]; ungrounded: string[] };
        computeGroundingScore: (response: string, documents: string[]) => number;
    };

    const claims = extractSpecificClaims(response);
    const context = documents.join(' ');
    const { grounded, ungrounded } = claimsGroundedInContext(claims, context);

    return {
        score: computeGroundingScore(response, documents),
        totalClaims: claims.length,
        groundedClaims: grounded.length,
        ungroundedClaims: ungrounded,
    };
}
