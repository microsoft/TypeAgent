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
});
