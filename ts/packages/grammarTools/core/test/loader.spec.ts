// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarFromBuffer } from "../src/index.js";

describe("loader", () => {
    it("loads a simple grammar from a buffer", () => {
        const source = `<Start> = hello world -> true;`;
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.grammar.grammar).toBeDefined();
            expect(result.grammar.source).toEqual({
                kind: "buffer",
                id: "test.agr",
            });
            expect(result.grammar.files).toHaveLength(1);
            expect(result.grammar.identifiers.ruleIds.length).toBeGreaterThan(
                0,
            );
        }
    });

    it("returns ok: false for unparseable input", () => {
        const source = `this is not valid grammar syntax <<<`;
        const result = loadGrammarFromBuffer("bad.agr", source);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics.length).toBeGreaterThan(0);
            expect(result.diagnostics[0].severity).toBe("error");
        }
    });

    it("returns source files in the result", () => {
        const source = `<Start> = play $(song:string) -> { action: "play", song };`;
        const result = loadGrammarFromBuffer("player.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.grammar.files![0].text).toBe(source);
            expect(result.grammar.files![0].id).toBe("player.agr");
        }
    });
});
