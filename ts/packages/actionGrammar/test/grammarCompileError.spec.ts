// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";

describe("Grammar Compiler", () => {
    describe("Error", () => {
        it("Undefined rule reference", () => {
            const grammarText = `
            @<Start> = <Pause>
            @<Pause> = <Undefined>
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
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
            loadGrammarRulesNoThrow("test", grammarText, errors);
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
            loadGrammarRulesNoThrow("test", grammarText, errors);
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
            loadGrammarRulesNoThrow("test", grammarText, errors);
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
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Referenced rule '<Pause>' does not produce a value for variable 'x' in definition '<Start>'",
            );
        });

        it("Undefined variable reference in value expression", () => {
            const grammarText = `
            @<Start> = $(name) plays music -> { player: name, action: undefinedVar }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Variable 'undefinedVar' is referenced in the value but not defined in the rule",
            );
        });

        it("Duplicate variable definition in same rule", () => {
            const grammarText = `
            @<Start> = $(name) plays $(name) -> { name }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Variable 'name' is already defined in this rule",
            );
        });

        it("Duplicate variable with different types", () => {
            const grammarText = `
            @<Start> = $(x:string) and $(x:number) -> { x }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Variable 'x' is already defined in this rule",
            );
        });

        it("Duplicate variable with rule reference", () => {
            const grammarText = `
            @<Start> = $(action:<Action>) $(action:<Action>) -> { action }
            @<Action> = play -> "play"
                      | pause -> "pause"
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Variable 'action' is already defined in this rule",
            );
        });

        it("Multiple duplicate variables in same rule", () => {
            const grammarText = `
            @<Start> = $(x) $(y) $(x) $(y) -> { x, y }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(2);
            expect(errors[0]).toContain(
                "error: Variable 'x' is already defined in this rule",
            );
            expect(errors[1]).toContain(
                "error: Variable 'y' is already defined in this rule",
            );
        });

        it("Variables in nested inline rules have separate scope", () => {
            const grammarText = `
            @<Start> = $(x) (and $(x))
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            // Nested inline rules have their own scope, so no error expected
            expect(errors.length).toBe(0);
        });

        it("Same variable in different rules should not error", () => {
            const grammarText = `
            @<Start> = <Rule1> | <Rule2>
            @<Rule1> = play $(name) -> { name }
            @<Rule1> = stop $(name) -> { name }
            @<Rule2> = resume $(name) -> { name }
                | pause $(name) -> { name }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Duplicate variable with optional modifier", () => {
            const grammarText = `
            @<Start> = $(name)? $(name) -> { name }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Variable 'name' is already defined in this rule",
            );
        });

        it("Start rule without value", () => {
            const grammarText = `
            @<Start> = $(x:string) $(y:string) wait
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Start rule '<Start>' does not produce a value.",
            );
        });

        it("Start rule with nested non-value rule", () => {
            const grammarText = `
            @<Start> = <Action>
            @<Action> = $(x:string) $(y:string) wait
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Start rule '<Start>' does not produce a value.",
            );
        });

        it("Start rule without value with startValueRequired:false option", () => {
            const grammarText = `
            @<Start> = $(x:string) $(y:string) wait
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                startValueRequired: false,
            });
            expect(errors.length).toBe(0);
        });

        it("Start rule with nested non-value rule and startValueRequired:false option", () => {
            const grammarText = `
            @<Start> = <Action>
            @<Action> = $(x:string) $(y:string) wait
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                startValueRequired: false,
            });
            expect(errors.length).toBe(0);
        });

        it("Start rule with value expression is valid", () => {
            const grammarText = `
            @<Start> = $(x:string) $(y:string) wait -> { x, y }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Start rule with single variable is valid", () => {
            const grammarText = `
            @<Start> = $(x:string)
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Start rule with single part and no variables is valid", () => {
            const grammarText = `
            @<Start> = play -> "play"
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
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
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain(
                "warning: Rule '<Unused>' is defined but never used.",
            );
        });

        it("Multiple variables without explicit value expression", () => {
            const grammarText = `
            @<Start> = <Action> -> "action"
            @<Action> = $(x:string) $(y:string)
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain(
                "warning: Rule with multiple variables and no explicit value expression doesn't have an implicit value.",
            );
        });

        it("Single variable without explicit value does not warn", () => {
            const grammarText = `
            @<Start> = <Action>
            @<Action> = $(x:string)
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });

        it("Multiple variables with explicit value does not warn", () => {
            const grammarText = `
            @<Start> = <Action>
            @<Action> = $(x:string) $(y:string) -> { x, y }
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });

        it("No variables without explicit value does not warn", () => {
            const grammarText = `
            @<Start> = <Action>
            @<Action> = play music
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });
    });

    describe("Type Imports", () => {
        it("Imported type reference should not error", () => {
            const grammarText = `
            @import { CustomType } from "types.ts"

            @<Start> = $(value:CustomType)
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Wildcard type import allows any type reference", () => {
            const grammarText = `
            @import * from "types.ts"

            @<Start> = $(x:CustomType) and $(y:AnotherType) -> { x, y }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Multiple type imports work together", () => {
            const grammarText = `
            @import { Type1 } from "file1.ts"
            @import { Type2 } from "file2.ts"

            @<Start> = $(x:Type1) $(y:Type2) -> { x, y }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Built-in types do not require imports", () => {
            const grammarText = `
            @<Start> = $(x:string) $(y:number) $(z:wildcard) -> { x, y, z }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Non-imported type errors", () => {
            const grammarText = `
            @import { CustomType } from "types.ts"

            @<Start> = $(x:CustomType) $(y:UndefinedType) -> { x, y }
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Undefined type 'UndefinedType' in variable 'y'",
            );
        });

        it("Type imports do not affect rule validation", () => {
            const grammarText = `
            @import { SomeType } from "types.ts"

            @<Start> = <SomeType>
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain(
                "error: Missing rule definition for '<SomeType>'",
            );
        });

        it("Unused imported type warns", () => {
            const grammarText = `
            @import { UnusedType } from "types.ts"

            @<Start> = play music
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain(
                "warning: Imported type 'UnusedType' is declared but never used.",
            );
        });

        it("Used imported type does not warn", () => {
            const grammarText = `
            @import { UsedType } from "types.ts"

            @<Start> = $(x:UsedType)
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });

        it("Only unused imported types warn when mixed with used ones", () => {
            const grammarText = `
            @import { UsedType } from "types.ts"
            @import { UnusedType } from "types.ts"

            @<Start> = $(x:UsedType)
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain(
                "warning: Imported type 'UnusedType' is declared but never used.",
            );
        });

        it("Wildcard type import does not warn when types are unused", () => {
            const grammarText = `
            @import * from "types.ts"

            @<Start> = play music
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });
    });
});
