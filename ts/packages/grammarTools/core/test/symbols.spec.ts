// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarFromBuffer, getSymbolIndex } from "../src/index.js";

describe("symbols", () => {
    const source = [
        "<Start> = play $(song:<Song>);",
        "<Start> = pause;",
        "<Song> = $(name:string);",
    ].join("\n");

    it("collects rule definitions", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        expect(index.byId.has("Start")).toBe(true);
        expect(index.byId.has("Song")).toBe(true);
    });

    it("returns signature with rule name", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const start = index.byId.get("Start");
        expect(start).toBeDefined();
        expect(start!.signature).toContain("<Start>");

        const song = index.byId.get("Song");
        expect(song).toBeDefined();
        expect(song!.signature).toContain("<Song>");
    });

    it("collects references to rules", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const songRefs = index.references("Song");
        // <Song> is referenced in the first rule via $(song:<Song>)
        expect(songRefs.length).toBeGreaterThan(0);
    });

    it("has location info for definitions", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const song = index.byId.get("Song");
        expect(song).toBeDefined();
        expect(song!.location.fileId).toBe("test.agr");
        expect(song!.location.range.start.line).toBe(2); // third line, 0-based
    });
});
