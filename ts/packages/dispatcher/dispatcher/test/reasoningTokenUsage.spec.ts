// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the shared `reasoningTokenUsage` helper: building the
 * token-usage record reasoning adapters report to the dispatcher, including the
 * per-block "thinking" (reasoning) token breakdown surfaced as a distinct
 * "Thinking Tokens" figure in the UI.
 */

import {
    buildReasoningActionResult,
    estimateReasoningTokens,
    formatThinkingDisplay,
    reasoningTokenUsage,
} from "../src/reasoning/reasoningLoopBase.js";

describe("reasoningTokenUsage", () => {
    it("returns undefined when no tokens were counted", () => {
        expect(reasoningTokenUsage(0, 0, 0)).toBeUndefined();
        expect(reasoningTokenUsage(0, 0, 0, [])).toBeUndefined();
    });

    it("reports prompt/completion/total without optional fields", () => {
        const usage = reasoningTokenUsage(100, 20, 0);
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
        });
        expect(usage).not.toHaveProperty("cached_tokens");
        expect(usage).not.toHaveProperty("thinking_tokens");
    });

    it("includes cached_tokens only when positive", () => {
        expect(reasoningTokenUsage(100, 20, 30)).toEqual({
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 150,
            cached_tokens: 30,
        });
    });

    it("tabulates per-block thinking tokens without inflating the total", () => {
        const usage = reasoningTokenUsage(100, 200, 0, [50, 30, 20]);
        // thinking tokens are a subset of completion tokens, so they must not
        // be added into total_tokens again.
        expect(usage).toEqual({
            prompt_tokens: 100,
            completion_tokens: 200,
            total_tokens: 300,
            thinking_tokens: [50, 30, 20],
        });
    });

    it("flags thinking tokens as estimated only when requested and present", () => {
        expect(reasoningTokenUsage(100, 200, 0, [50, 30], true)).toEqual({
            prompt_tokens: 100,
            completion_tokens: 200,
            total_tokens: 300,
            thinking_tokens: [50, 30],
            thinking_tokens_estimated: true,
        });
        // Billed by default (no flag argument).
        expect(reasoningTokenUsage(100, 200, 0, [50, 30])).not.toHaveProperty(
            "thinking_tokens_estimated",
        );
        // The flag rides on the breakdown: no blocks => no flag.
        expect(reasoningTokenUsage(100, 200, 0, [], true)).not.toHaveProperty(
            "thinking_tokens_estimated",
        );
    });

    it("drops non-positive thinking-token entries and omits an all-empty breakdown", () => {
        expect(reasoningTokenUsage(100, 20, 0, [0, 40, 0])).toEqual({
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            thinking_tokens: [40],
        });
        expect(reasoningTokenUsage(100, 20, 0, [0, 0])).not.toHaveProperty(
            "thinking_tokens",
        );
    });
});

describe("estimateReasoningTokens", () => {
    it("returns 0 for empty or whitespace-only text", () => {
        expect(estimateReasoningTokens("")).toBe(0);
        expect(estimateReasoningTokens("   \n\t ")).toBe(0);
    });

    it("estimates ~4 characters per token, rounding up", () => {
        // 8 trimmed chars => 2 tokens.
        expect(estimateReasoningTokens("abcdefgh")).toBe(2);
        // 9 chars => ceil(9/4) = 3.
        expect(estimateReasoningTokens("abcdefghi")).toBe(3);
        // Leading/trailing whitespace is ignored before counting.
        expect(estimateReasoningTokens("  abcd  ")).toBe(1);
    });
});

describe("formatThinkingDisplay", () => {
    it("renders a plain Thinking header with no token attribute when none given", () => {
        const html = formatThinkingDisplay("some reasoning");
        expect(html).toContain("<summary>Thinking</summary>");
        expect(html).not.toContain("data-thinking-tokens");
    });

    it("carries the per-block token estimate as a data attribute, not in the header", () => {
        const html = formatThinkingDisplay("some reasoning", 216);
        // The count rides on the <details> so the client can render it in the
        // metrics row; the header text stays a plain "Thinking".
        expect(html).toContain('data-thinking-tokens="216"');
        expect(html).toContain("<summary>Thinking</summary>");
        expect(html).not.toContain("tokens</");
    });

    it("omits the attribute for a zero/undefined estimate", () => {
        expect(formatThinkingDisplay("x", 0)).toContain(
            "<summary>Thinking</summary>",
        );
        expect(formatThinkingDisplay("x", 0)).not.toContain(
            "data-thinking-tokens",
        );
        expect(formatThinkingDisplay("x")).not.toContain(
            "data-thinking-tokens",
        );
    });

    it("escapes HTML in the reasoning text", () => {
        const html = formatThinkingDisplay("<b>a & b</b>", 5);
        expect(html).toContain("&lt;b&gt;a &amp; b&lt;/b&gt;");
    });
});

describe("buildReasoningActionResult", () => {
    const display = [{ type: "text", content: "Fetched 42 chars" }];

    it("prefers the action's historyText (the full model-facing output)", () => {
        const result = buildReasoningActionResult(
            {
                historyText: "Content from example.com:\n\nfull page text",
                entities: [],
            },
            display,
        );
        expect(result).toEqual({
            text: "Content from example.com:\n\nfull page text",
            isError: false,
        });
    });

    it("falls back to captured display when there is no historyText", () => {
        const result = buildReasoningActionResult({ entities: [] }, display);
        expect(result.isError).toBe(false);
        expect(result.text).toBe(JSON.stringify(display));
    });

    it("treats empty/whitespace historyText as absent", () => {
        const result = buildReasoningActionResult(
            { historyText: "   \n", entities: [] },
            display,
        );
        expect(result.text).toBe(JSON.stringify(display));
    });

    it("surfaces an error result as an error", () => {
        const result = buildReasoningActionResult(
            { error: "Utility action failed: API key not found" },
            display,
        );
        expect(result).toEqual({
            text: "Error: Utility action failed: API key not found",
            isError: true,
        });
    });

    it("falls back to display for an undefined result", () => {
        expect(buildReasoningActionResult(undefined, display)).toEqual({
            text: JSON.stringify(display),
            isError: false,
        });
    });
});
