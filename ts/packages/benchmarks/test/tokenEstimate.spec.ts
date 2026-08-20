// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

import {
    estimatePromptTokens,
    TOKEN_ESTIMATE_OVERHEAD,
} from "../src/core/tokenEstimate.js";

describe("core tokenEstimate", () => {
    it("adds the overhead offset over the raw o200k count", () => {
        const text = "The quick brown fox jumps over the lazy dog.";
        const raw = countTokens(text);
        expect(estimatePromptTokens(text)).toBe(
            Math.ceil(raw * (1 + TOKEN_ESTIMATE_OVERHEAD)),
        );
    });

    it("never underestimates the raw token count", () => {
        for (const text of ["", "a", "hello world", "x".repeat(2000)]) {
            expect(estimatePromptTokens(text)).toBeGreaterThanOrEqual(
                countTokens(text),
            );
        }
    });

    it("returns an integer token budget", () => {
        const n = estimatePromptTokens(
            "tokenization produces fractional overhead",
        );
        expect(Number.isInteger(n)).toBe(true);
    });
});
