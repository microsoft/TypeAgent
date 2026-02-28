// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";

describe("Grammar Compiler", () => {
    describe("Error", () => {
        it("Undefined rule reference", () => {
            const grammarText = `
            <Start> = <Pause>;
            <Pause> = <Undefined>;
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
            <Start> = <Pause>;
            <Pause> = $(x:<Undefined>);
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
            <Start> = $(x:<Pause>);
            <Pause> = <Wait> <Stop>;
            <Wait> = wait;
            <Stop> = stop;
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
            <Start> = $(x:<Pause>);
            <Pause> = please <Wait>;
            <Wait> = wait;
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
            <Start> = $(x:<Pause>);
            // This rule has multiple variable references, so cannot produce a single (implicit) value
            <Pause> = $(y:<Wait>) and $(z:<Stop>);
            <Wait> = please wait -> 1;
            <Stop> = stop now -> 2;
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
            <Start> = $(name) plays music -> { player: name, action: undefinedVar };
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
            <Start> = $(name) plays $(name) -> { name };
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
            <Start> = $(x:string) and $(x:number) -> { x };
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
            <Start> = $(action:<Action>) $(action:<Action>) -> { action };
            <Action> = play -> "play"
                      | pause -> "pause";
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
            <Start> = $(x) $(y) $(x) $(y) -> { x, y };
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
            <Start> = $(x) (and $(x));
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            // Nested inline rules have their own scope, so no error expected
            expect(errors.length).toBe(0);
        });

        it("Same variable in different rules should not error", () => {
            const grammarText = `
            <Start> = <Rule1> | <Rule2>;
            <Rule1> = play $(name) -> { name };
            <Rule1> = stop $(name) -> { name };
            <Rule2> = resume $(name) -> { name }
                | pause $(name) -> { name };
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Duplicate variable with optional modifier", () => {
            const grammarText = `
            <Start> = $(name)? $(name) -> { name };
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
            <Start> = $(x:string) $(y:string) wait;
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
            <Start> = <Action>;
            <Action> = $(x:string) $(y:string) wait;
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
            <Start> = $(x:string) $(y:string) wait;
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                startValueRequired: false,
            });
            expect(errors.length).toBe(0);
        });

        it("Start rule with nested non-value rule and startValueRequired:false option", () => {
            const grammarText = `
            <Start> = <Action>;
            <Action> = $(x:string) $(y:string) wait;
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                startValueRequired: false,
            });
            expect(errors.length).toBe(0);
        });

        it("Start rule with value expression is valid", () => {
            const grammarText = `
            <Start> = $(x:string) $(y:string) wait -> { x, y };
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Start rule with single variable is valid", () => {
            const grammarText = `
            <Start> = $(x:string);
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Start rule with single part and no variables is valid", () => {
            const grammarText = `
            <Start> = play -> "play";
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });
    });
    describe("Warning", () => {
        it("Unused", () => {
            const grammarText = `
            <Start> = <Pause>;
            <Pause> = pause;
            <Unused> = unused;
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
            <Start> = <Action> -> "action";
            <Action> = $(x:string) $(y:string);
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
            <Start> = <Action>;
            <Action> = $(x:string);
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });

        it("Multiple variables with explicit value does not warn", () => {
            const grammarText = `
            <Start> = <Action>;
            <Action> = $(x:string) $(y:string) -> { x, y };
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });

        it("No variables without explicit value does not warn", () => {
            const grammarText = `
            <Start> = <Action>;
            <Action> = play music;
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });
    });

    describe("Epsilon-reachable recursive cycles", () => {
        // Using startValueRequired: false to avoid spurious "no value" errors
        // in grammars that are only testing cycle detection.
        const opts = { startValueRequired: false };

        describe("Error", () => {
            it("direct self-reference <T> = <T>", () => {
                const grammarText = `<Start> = <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<Start>");
            });

            it("self-reference as first part before literal <T> = <T> foo", () => {
                const grammarText = `<Start> = <Start> foo;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<Start>");
            });

            it("mutual epsilon cycle <A> = <B>, <B> = <A>", () => {
                const grammarText = `
                    <Start> = <A>;
                    <A> = <B>;
                    <B> = <A>;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<A>");
            });

            it("optional inline rule before self-reference <T> = (foo)? <T>", () => {
                const grammarText = `<Start> = (foo)? <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<Start>");
            });

            it("optional part in mutual cycle <A> = (foo)? <B>, <B> = <A>", () => {
                const grammarText = `
                    <Start> = <A>;
                    <A> = (foo)? <B>;
                    <B> = <A>;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<A>");
            });

            it("inner epsilon cycle despite outer mandatory input: foo <B>, <B> = <C>, <C> = <B>", () => {
                const grammarText = `
                    <Start> = foo <B>;
                    <B> = <C>;
                    <C> = <B>;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<B>");
            });

            it("three-node epsilon cycle <A> = <B>, <B> = <C>, <C> = <A>", () => {
                const grammarText = `
                    <Start> = <A>;
                    <A> = <B>;
                    <B> = <C>;
                    <C> = <A>;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<A>");
                // The back-reference is inside <C>, so the definition attribution
                // should point there.
                expect(errors[0]).toContain("<C>");
            });

            it("epsilon cycle in one alternative of multi-alternative rule <T> = foo | <T>", () => {
                const grammarText = `<Start> = foo | <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<Start>");
            });

            it("nullable intermediate rule creates epsilon path <A> = <B> <A>, <B> = (foo)?", () => {
                const grammarText = `
                    <Start> = <A>;
                    <A> = <B> <A>;
                    <B> = (foo)?;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<A>");
            });

            it("optional variable self-reference <T> = $(x:<T>)?", () => {
                const grammarText = `<Start> = $(x:<Start>)?;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<Start>");
            });

            it("Kleene star group before self-reference <T> = (foo)* <T>", () => {
                // (foo)* is optional (zero or more), so <T> is reachable via ε
                const grammarText = `<Start> = (foo)* <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<Start>");
            });

            it("Kleene star group containing self-reference <T> = (<T>)* foo", () => {
                // The first thing attempted inside (<T>)* is <T> itself — ε-cycle
                const grammarText = `<Start> = (<Start>)* foo;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(1);
                expect(errors[0]).toContain("error:");
                expect(errors[0]).toContain("<Start>");
            });

            it("two independent epsilon cycles each reported separately", () => {
                const grammarText = `
                    <Start> = <A> | <B>;
                    <A> = <A>;
                    <B> = <B>;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(2);
                expect(errors.some((e) => e.includes("<A>"))).toBe(true);
                expect(errors.some((e) => e.includes("<B>"))).toBe(true);
            });
        });

        describe("Valid (no error)", () => {
            it("right-recursive with mandatory input <T> = foo <T>", () => {
                const grammarText = `<Start> = foo <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("mutual recursion with mandatory input in caller <A> = foo <B>, <B> = <A>", () => {
                const grammarText = `
                    <Start> = <A>;
                    <A> = foo <B>;
                    <B> = <A>;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("non-nullable rule before self-reference <A> = <B> <A>, <B> = foo", () => {
                const grammarText = `
                    <Start> = <A>;
                    <A> = <B> <A>;
                    <B> = foo;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("both rules consume mandatory input <A> = foo <B>, <B> = bar <A>", () => {
                const grammarText = `
                    <Start> = <A>;
                    <A> = foo <B>;
                    <B> = bar <A>;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("number variable before self-reference <T> = $(n:number) <T>", () => {
                const grammarText = `<Start> = $(n:number) <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("wildcard variable before self-reference <T> = $(x) <T>", () => {
                const grammarText = `<Start> = $(x) <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("safe recursive alternative alongside non-recursive alternative <T> = foo | bar <T>", () => {
                // The 'bar <T>' alternative is safe because 'bar' is consumed first.
                // The plain 'foo' alternative is trivially non-recursive.
                const grammarText = `<Start> = foo | bar <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("optional self-reference after mandatory literal <T> = foo $(x:<T>)?", () => {
                // 'foo' consumes mandatory input, so the optional back-ref is safe.
                const grammarText = `<Start> = foo $(x:<Start>)?;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("non-nullable multi-alternative intermediate <A> = <B> <A>, <B> = foo | bar", () => {
                // <B> has two alternatives, both consuming mandatory input, so it
                // is non-nullable and clears the epsilon-reachable set before <A>.
                const grammarText = `
                    <Start> = <A>;
                    <A> = <B> <A>;
                    <B> = foo | bar;
                `;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });

            it("Kleene plus before self-reference <T> = (foo)+ <T>", () => {
                // (foo)+ must match at least one 'foo', so mandatory input is
                // consumed before the recursive <T>.
                const grammarText = `<Start> = (foo)+ <Start>;`;
                const errors: string[] = [];
                loadGrammarRulesNoThrow(
                    "test",
                    grammarText,
                    errors,
                    undefined,
                    opts,
                );
                expect(errors.length).toBe(0);
            });
        });
    });

    describe("Type Imports", () => {
        it("Imported type reference should not error", () => {
            const grammarText = `
            import { CustomType } from "types.ts";

            <Start> = $(value:CustomType);
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Wildcard type import allows any type reference", () => {
            const grammarText = `
            import * from "types.ts";

            <Start> = $(x:CustomType) and $(y:AnotherType) -> { x, y };
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Multiple type imports work together", () => {
            const grammarText = `
            import { Type1 } from "file1.ts";
            import { Type2 } from "file2.ts";

            <Start> = $(x:Type1) $(y:Type2) -> { x, y };
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Built-in types do not require imports", () => {
            const grammarText = `
            <Start> = $(x:string) $(y:number) $(z:wildcard) -> { x, y, z };
        `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors);
            expect(errors.length).toBe(0);
        });

        it("Non-imported type errors", () => {
            const grammarText = `
            import { CustomType } from "types.ts";

            <Start> = $(x:CustomType) $(y:UndefinedType) -> { x, y };
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
            import { SomeType } from "types.ts";

            <Start> = <SomeType>;
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
            import { UnusedType } from "types.ts";

            <Start> = play music;
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
            import { UsedType } from "types.ts";

            <Start> = $(x:UsedType);
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });

        it("Only unused imported types warn when mixed with used ones", () => {
            const grammarText = `
            import { UsedType } from "types.ts";
            import { UnusedType } from "types.ts";

            <Start> = $(x:UsedType);
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
            import * from "types.ts";

            <Start> = play music;
        `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings);
            expect(errors.length).toBe(0);
            expect(warnings.length).toBe(0);
        });
    });
});
