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

        it("Variable reference to non-value rule", () => {
            // Note: Single-literal rules (even multi-word like "please pause") now implicitly
            // produce a value (the literal string itself). Rules with multiple parts
            // (e.g., two rule references) do NOT produce an implicit value.
            const grammarText = `
            @<Start> = $(x:<Pause>)
            @<Pause> = <Wait> <Stop>
            @<Wait> = wait
            @<Stop> = stop
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Referenced rule '<Pause>' does not produce a value for variable 'x' in definition '<Start>'",
            );
        });
        it("Variable reference to non-value rule in nested rule", () => {
            const grammarText = `
            @<Start> = $(x:<Pause>)
            @<Pause> = please <Wait>
            @<Wait> = wait
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Referenced rule '<Pause>' does not produce a value for variable 'x' in definition '<Start>'",
            );
        });
        it("Variable reference to non-value rules with multiple values", () => {
            const grammarText = `
            @<Start> = $(x:<Pause>)
            // This rule has multiple variable references, so cannot produce a single (implicit) value
            @<Pause> = $(y:<Wait>) and $(z:<Stop>)
            @<Wait> = please wait -> 1
            @<Stop> = stop now -> 2
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Referenced rule '<Pause>' does not produce a value for variable 'x' in definition '<Start>'",
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
