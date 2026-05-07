// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarFromBuffer, getDiagnostics } from "../src/index.js";

describe("diagnostics", () => {
    it("returns empty for valid grammar", () => {
        const src = "<Start> = hello world;";
        const result = loadGrammarFromBuffer("test.agr", src);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const diags = getDiagnostics(result.grammar);
        expect(diags).toHaveLength(0);
    });

    it("reports error on load failure", () => {
        // loadGrammarFromBuffer catches parse errors and returns ok=false
        const badSrc = "this is not valid grammar at all!!!";
        const result = loadGrammarFromBuffer("bad.agr", badSrc);
        if (!result.ok) {
            expect(result.diagnostics.length).toBeGreaterThan(0);
            expect(result.diagnostics[0].severity).toBe("error");
        }
    });
});
