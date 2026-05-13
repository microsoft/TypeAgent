/**
 * Shared question/action detection logic.
 * Used by both direct and MCP-redirect hooks.
 */

const QUESTION_PATTERNS = [
    /^\s*who\b/i,
    /^\s*what\b/i,
    /^\s*why\b/i,
    /^\s*when\b/i,
    /^\s*where\b/i,
    /^\s*how\b/i,
    /^\s*which\b/i,
    /^\s*whose\b/i,
    /^\s*whom\b/i,
    /^\s*explain\b/i,
    /^\s*describe\b/i,
    /^\s*tell me about\b/i,
    /^\s*can you explain\b/i,
    /^\s*could you explain\b/i,
];

export function shouldTryTypeAgent(prompt: string): boolean {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return false;

    const isQuestion = QUESTION_PATTERNS.some((pattern) =>
        pattern.test(trimmedPrompt),
    );
    return !isQuestion;
}
