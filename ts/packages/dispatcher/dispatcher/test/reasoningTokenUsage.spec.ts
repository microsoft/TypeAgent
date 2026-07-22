// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the shared `reasoningTokenUsage` helper: building the
 * token-usage record reasoning adapters report to the dispatcher, including the
 * per-block "thinking" (reasoning) token breakdown surfaced as a distinct
 * "Thinking Tokens" figure in the UI.
 */

import { reasoningTokenUsage } from "../src/reasoning/reasoningLoopBase.js";

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
