// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";

describe("Grammar Compiler", () => {
    describe("Error", () => {
        it("Undefined rule reference", () => {
            const grammarText = `
            @<Start> = <Pause>
            @<Pause> = <Undefined>
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Missing rule definition for '<Undefined>'",
            );
        });

        it("Undefined rule reference in variable", () => {
            const grammarText = `
            @<Start> = <Pause>
            @<Pause> = $(x:<Undefined>)
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Missing rule definition for '<Undefined>'",
            );
        });
    });
    describe("Warning", () => {
        it("Unused", () => {
            const grammarText = `
            @<Start> = <Pause>
            @<Pause> = pause
            @<Unused> = unused
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRules("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain(
                "warning: Rule '<Unused>' is defined but never used.",
            );
        });
    });
});
