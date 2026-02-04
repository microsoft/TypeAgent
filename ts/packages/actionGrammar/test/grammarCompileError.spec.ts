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
            const grammarText = `
            @<Start> = $(x:<Pause>)
            @<Pause> = pause
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

    describe("Imports", () => {
        it("Imported rule reference should not error", () => {
            const grammarText = `
            @import { ExternalRule } from "external.grammar"

            @<Start> = <ExternalRule> world
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Wildcard import allows any rule reference", () => {
            const grammarText = `
            @import * from "external.grammar"

            @<Start> = <AnyExternalRule> and <AnotherExternal>
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Multiple imports work together", () => {
            const grammarText = `
            @import { Rule1 } from "file1.grammar"
            @import { Rule2 } from "file2.grammar"

            @<Start> = <Rule1> <Rule2>
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Imported rule in variable reference", () => {
            const grammarText = `
            @import { ExternalRule } from "external.grammar"

            @<Start> = $(x:<ExternalRule>)
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Non-imported rule still errors", () => {
            const grammarText = `
            @import { ExternalRule } from "external.grammar"

            @<Start> = <ExternalRule> <UndefinedRule>
        `;
            const errors: string[] = [];
            loadGrammarRules("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Missing rule definition for '<UndefinedRule>'",
            );
        });

        it("Local definition overrides import", () => {
            const grammarText = `
            @import { LocalRule } from "external.grammar"

            @<Start> = <LocalRule>
            @<LocalRule> = local definition
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRules("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            // No warning about unused rule since it's referenced
            expect(warnings.length).toBe(0);
        });
    });
});
