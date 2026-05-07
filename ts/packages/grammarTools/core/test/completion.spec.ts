// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { previewCompletion, loadGrammarFromBuffer } from "../src/index.js";

describe("completion", () => {
    const source = `<Start> = play $(song:string) -> { action: "play", song };
<Start> = pause -> { action: "pause" };`;

    it("returns completions for a partial input", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const preview = previewCompletion(result.grammar, "pla");
        expect(preview.groups.length).toBeGreaterThan(0);
        // "pla" is a prefix of "play" and "pause" - completions returned
        const allCompletions = preview.groups.flatMap((g) => g.completions);
        expect(allCompletions.length).toBeGreaterThan(0);
    });

    it("returns groups with separatorMode", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const preview = previewCompletion(result.grammar, "");
        for (const group of preview.groups) {
            expect(group.separatorMode).toBeDefined();
            expect(group.completions).toBeInstanceOf(Array);
        }
    });

    it("returns fewer completions for unrelated input than empty input", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const emptyPreview = previewCompletion(result.grammar, "");
        const unrelatedPreview = previewCompletion(
            result.grammar,
            "xyznotagrammartoken",
        );
        const emptyTotal = emptyPreview.groups.reduce(
            (sum, g) => sum + g.completions.length,
            0,
        );
        const unrelatedTotal = unrelatedPreview.groups.reduce(
            (sum, g) => sum + g.completions.length,
            0,
        );
        expect(unrelatedTotal).toBeLessThanOrEqual(emptyTotal);
    });

    it("returns completions for empty input", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const preview = previewCompletion(result.grammar, "");
        // Empty input should still return top-level completions
        expect(preview.groups.length).toBeGreaterThan(0);
    });

    it("includes matchedPrefixLength", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const preview = previewCompletion(result.grammar, "pla");
        expect(typeof preview.matchedPrefixLength).toBe("number");
    });

    it("includes directionSensitive flag", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const preview = previewCompletion(result.grammar, "p");
        expect(typeof preview.directionSensitive).toBe("boolean");
    });

    it("returns afterWildcard field", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const preview = previewCompletion(result.grammar, "play ");
        expect(preview.afterWildcard).toBeDefined();
    });
});
