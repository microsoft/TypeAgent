// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import { SchemaCreator } from "@typeagent/action-schema";
import type { SchemaLoader } from "../src/grammarCompiler.js";
import type { SchemaTypeDefinition } from "@typeagent/action-schema";

describe("Value type validation", () => {
    // Build a mock SchemaLoader for testing
    // PlayAction: { actionName: "play"; trackName: string }
    // PauseAction: { actionName: "pause" }
    const PlayActionDef = SchemaCreator.intf(
        "PlayAction",
        SchemaCreator.obj({
            actionName: SchemaCreator.field(SchemaCreator.string("play")),
            trackName: SchemaCreator.field(SchemaCreator.string()),
        }),
        undefined,
        true,
    );
    const PauseActionDef = SchemaCreator.intf(
        "PauseAction",
        SchemaCreator.obj({
            actionName: SchemaCreator.field(SchemaCreator.string("pause")),
        }),
        undefined,
        true,
    );
    const typeRegistry = new Map<string, SchemaTypeDefinition>([
        ["PlayAction", PlayActionDef],
        ["PauseAction", PauseActionDef],
    ]);
    const mockSchemaLoader: SchemaLoader = (
        typeName: string,
    ): SchemaTypeDefinition | undefined => {
        return typeRegistry.get(typeName);
    };

    it("valid value matches declared type - no errors", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play $(track:string) -> { actionName: "play", trackName: track };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("missing required field produces error", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play music -> { actionName: "play" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("Missing required property");
        expect(errors[0]).toContain("trackName");
    });

    it("wrong string literal in string-union produces error", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play $(track:string) -> { actionName: "wrong", trackName: track };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("'play'");
        expect(errors[0]).toContain("'wrong'");
    });

    it("extraneous property produces error", () => {
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = pause -> { actionName: "pause", extra: "bad" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("Extraneous property");
        expect(errors[0]).toContain("extra");
    });

    it("union value type - value matches one member - no errors", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction =
                play $(track:string) -> { actionName: "play", trackName: track }
              | pause -> { actionName: "pause" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("union value type - value matches neither member - error", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction =
                stop music -> { actionName: "stop" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("does not match any union type");
    });

    it("no schema loader - validation silently skipped", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play music -> { actionName: "wrong" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors);
        // No SchemaLoader provided, so no validation occurs
        expect(errors.length).toBe(0);
    });

    it("unresolved type produces error when schema loader present", () => {
        const emptyLoader: SchemaLoader = () => undefined;
        const grammarText = `
            import { UnknownType } from "schema.ts";
            <Start> : UnknownType = hello -> { actionName: "greet" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: emptyLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("Cannot resolve type");
        expect(errors[0]).toContain("UnknownType");
        expect(errors[0]).toContain("schema.ts");
    });

    it("non-exported type produces error", () => {
        const PrivateTypeDef = SchemaCreator.intf(
            "PrivateType",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
            }),
        );
        const loader: SchemaLoader = (typeName) =>
            typeName === "PrivateType" ? PrivateTypeDef : undefined;
        const grammarText = `
            import { PrivateType } from "schema.ts";
            <Start> : PrivateType = hello -> { actionName: "test" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: loader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("not exported");
        expect(errors[0]).toContain("PrivateType");
    });

    it("number variable matches number field", () => {
        const NumActionDef = SchemaCreator.intf(
            "NumAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(
                    SchemaCreator.string("setVolume"),
                ),
                level: SchemaCreator.field(SchemaCreator.number()),
            }),
            undefined,
            true,
        );
        const loader: SchemaLoader = (typeName) =>
            typeName === "NumAction" ? NumActionDef : undefined;

        const grammarText = `
            import { NumAction } from "schema.ts";
            <Start> : NumAction = set volume to $(level:number) -> { actionName: "setVolume", level };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: loader,
        });
        expect(errors.length).toBe(0);
    });

    it("string variable in number field produces error", () => {
        const NumActionDef = SchemaCreator.intf(
            "NumAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(
                    SchemaCreator.string("setVolume"),
                ),
                level: SchemaCreator.field(SchemaCreator.number()),
            }),
            undefined,
            true,
        );
        const loader: SchemaLoader = (typeName) =>
            typeName === "NumAction" ? NumActionDef : undefined;

        const grammarText = `
            import { NumAction } from "schema.ts";
            <Start> : NumAction = set volume to $(level:string) -> { actionName: "setVolume", level };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: loader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("expected number");
        expect(errors[0]).toContain("level");
    });

    it("optional field is not required", () => {
        const OptActionDef = SchemaCreator.intf(
            "OptAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                extra: SchemaCreator.optional(SchemaCreator.string()),
            }),
            undefined,
            true,
        );
        const loader: SchemaLoader = (typeName) =>
            typeName === "OptAction" ? OptActionDef : undefined;

        const grammarText = `
            import { OptAction } from "schema.ts";
            <Start> : OptAction = test -> { actionName: "test" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: loader,
        });
        expect(errors.length).toBe(0);
    });

    it("validation propagates through sub-rule references", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction = <Play> | <Pause>;
            <Play> = play $(track:string) -> { actionName: "play", trackName: track };
            <Pause> = pause -> { actionName: "pause" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("validation catches error in sub-rule value", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction = <Play> | <Pause>;
            <Play> = play $(track:string) -> { actionName: "wrong", trackName: track };
            <Pause> = pause -> { actionName: "pause" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("does not match any union type");
    });

    it("validation propagates through nested sub-rule chain", () => {
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = <Command>;
            <Command> = <Pause>;
            <Pause> = pause -> { actionName: "pause" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("validation catches error through nested sub-rule chain", () => {
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = <Command>;
            <Command> = <Bad>;
            <Bad> = stop -> { actionName: "stop" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("'pause'");
    });

    it("validation skips variable-bearing sub-rules", () => {
        // When a rule captures a sub-rule into a variable, the sub-rule's
        // own value is the variable's capture, not the parent rule's value.
        // Validation should not follow into variable sub-rules.
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play $(track:<TrackName>) -> { actionName: "play", trackName: track };
            <TrackName> = $(x:string);
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("value type with unimported type produces error", () => {
        const grammarText = `
            <Start> : UnimportedType = hello -> { actionName: "greet" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors);
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("not imported");
        expect(errors[0]).toContain("UnimportedType");
    });

    it("validation propagates through inline group", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction = (
                play $(track:string) -> { actionName: "play", trackName: track }
              | pause -> { actionName: "pause" }
            );
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("validation catches error in inline group", () => {
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = (
                pause -> { actionName: "pause" }
              | stop -> { actionName: "stop" }
            );
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("'pause'");
    });

    it("string literal passthrough does not cause validation error", () => {
        // A bare string literal has an implicit value (the matched text).
        // Since there's no CompiledValueNode, collectLeafValues finds
        // nothing — validation is silently skipped, not errored.
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = pause;
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("mix of passthrough and explicit in alternatives", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction =
                <Pause>
              | play $(track:string) -> { actionName: "play", trackName: track };
            <Pause> = pause -> { actionName: "pause" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("single-variable implicit rule is not validated", () => {
        // $(x:string) with no -> produces the variable's value implicitly.
        // This can't be structurally validated at compile time.
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = <Wrapper>;
            <Wrapper> = $(x:string);
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        // Single-variable implicit value can't be checked — no error
        expect(errors.length).toBe(0);
    });

    it("error in passthrough sub-rule of mixed alternatives", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction =
                <Bad>
              | play $(track:string) -> { actionName: "play", trackName: track };
            <Bad> = stop -> { actionName: "stop" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("does not match any union type");
    });

    it("error in explicit value of mixed alternatives", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction =
                <Pause>
              | play $(track:string) -> { actionName: "wrong", trackName: track };
            <Pause> = pause -> { actionName: "pause" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("does not match any union type");
    });

    it("errors in multiple alternatives are each reported", () => {
        const grammarText = `
            import { PlayAction } from "schema.ts";
            import { PauseAction } from "schema.ts";
            <Start> : PlayAction | PauseAction =
                <Bad1>
              | stop -> { actionName: "stop" };
            <Bad1> = quit -> { actionName: "quit" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(2);
    });

    it("error in inline group with passthrough", () => {
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = <Wrapper>;
            <Wrapper> = (
                pause -> { actionName: "pause" }
              | stop -> { actionName: "stop" }
            );
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("'pause'");
    });

    it("error in nested chain with inline group", () => {
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = <A>;
            <A> = <B>;
            <B> = (stop -> { actionName: "stop" });
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("'pause'");
    });

    describe("Error positions", () => {
        it("error points to value expression position", () => {
            // Line 2, column 47 is where { starts in "-> { actionName: "wrong" }"
            const grammarText = `import { PauseAction } from "schema.ts";
<Start> : PauseAction = pause -> { actionName: "wrong" };`;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("(2,34)");
        });

        it("error position for second alternative", () => {
            const grammarText = `import { PauseAction } from "schema.ts";
<Start> : PauseAction =
    pause -> { actionName: "pause" }
  | stop -> { actionName: "stop" };`;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(1);
            // Error should be on line 4 (the "stop" alternative), not line 1
            expect(errors[0]).toContain("(4,");
        });

        it("error position for sub-rule value", () => {
            const grammarText = `import { PauseAction } from "schema.ts";
<Start> : PauseAction = <Bad>;
<Bad> = stop -> { actionName: "stop" };`;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(1);
            // Error should point to line 3 where the bad value is
            expect(errors[0]).toContain("(3,");
        });

        it("error position does not fall back to (1,1)", () => {
            const grammarText = `import { PauseAction } from "schema.ts";
<Start> : PauseAction = stop -> { actionName: "stop" };`;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).not.toContain("(1,1)");
        });
    });

    describe("Type inference through rule references", () => {
        it("infers number type through single-variable implicit rule", () => {
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<TrackName>) -> { actionName: "play", trackName: track };
                <TrackName> = $(x:number);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // trackName is string in PlayAction, but <TrackName> produces number
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected string");
            expect(errors[0]).toContain("track");
        });

        it("infers string type through single-variable implicit rule", () => {
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<TrackName>) -> { actionName: "play", trackName: track };
                <TrackName> = $(x:wildcard);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // wildcard → string, matches trackName: string
            expect(errors.length).toBe(0);
        });

        it("infers type through chain of rule references", () => {
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<Wrapper>) -> { actionName: "play", trackName: track };
                <Wrapper> = $(x:<Inner>);
                <Inner> = $(x:number);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // Inner → number, Wrapper → number, track → number, but expected string
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected string");
        });

        it("infers type through explicit value expression with variable ref", () => {
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<TrackPhrase>) -> { actionName: "play", trackName: track };
                <TrackPhrase> = $(name:<TrackName>) -> name;
                <TrackName> = $(x:number);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // TrackName → number, TrackPhrase "-> name" → number, track → number
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected string");
        });

        it("infers type through passthrough rule reference", () => {
            const NumActionDef = SchemaCreator.intf(
                "NumAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    level: SchemaCreator.field(SchemaCreator.number()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "NumAction" ? NumActionDef : undefined;

            const grammarText = `
                import { NumAction } from "schema.ts";
                <Start> : NumAction = set $(level:<Wrapper>) -> { actionName: "test", level };
                <Wrapper> = <Inner>;
                <Inner> = $(x:string);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            // Inner → string, Wrapper passthrough → string, but level: number expected
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected number");
        });

        it("no error when inferred types match", () => {
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<TrackPhrase>) -> { actionName: "play", trackName: track };
                <TrackPhrase> = $(name:<TrackName>) -> name;
                <TrackName> = $(x:wildcard);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("inference is cached across multiple references", () => {
            // <Shared> is referenced by both alternatives — should only be inferred once
            const grammarText = `
                import { PlayAction } from "schema.ts";
                import { PauseAction } from "schema.ts";
                <Start> : PlayAction | PauseAction =
                    play $(track:<Shared>) -> { actionName: "play", trackName: track }
                  | get $(track:<Shared>) -> { actionName: "play", trackName: track };
                <Shared> = $(x:wildcard);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("circular rule infers type via fixed-point iteration", () => {
            // <Items> is recursive: it references itself via <Items>.
            // The base case produces a string, the recursive case passes through.
            // Fixed-point iteration should infer string for <Items>.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<Items>) -> { actionName: "play", trackName: track };
                <Items> = $(x:string) | $(x:string) and <Items>;
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // <Items> should infer as string via fixed-point; track: string matches trackName: string
            expect(errors.length).toBe(0);
        });

        it("circular rule with type mismatch produces error after fixed-point", () => {
            const NumActionDef = SchemaCreator.intf(
                "NumAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    level: SchemaCreator.field(SchemaCreator.number()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "NumAction" ? NumActionDef : undefined;

            // <Items> recurses and produces string, but level expects number
            const grammarText = `
                import { NumAction } from "schema.ts";
                <Start> : NumAction = set $(level:<Items>) -> { actionName: "test", level };
                <Items> = $(x:string) | $(x:string) and <Items>;
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected number");
        });

        it("structurally recursive rule produces self-referential type", () => {
            // <Tree> is structurally recursive: base case is string,
            // recursive case wraps <Tree> in an object.
            // The type should be: Tree = string | { inner: Tree }
            const TreeActionDef = SchemaCreator.intf(
                "TreeAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("tree"),
                    ),
                    // Use 'any' so we accept whatever recursive type is inferred
                    data: SchemaCreator.field(SchemaCreator.any()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "TreeAction" ? TreeActionDef : undefined;

            const grammarText = `
                import { TreeAction } from "schema.ts";
                <Start> : TreeAction = show $(data:<Tree>) -> { actionName: "tree", data };
                <Tree> = $(x:string) | wrap $(y:<Tree>) -> { inner: y };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            // Should compile without errors — the recursive type is valid
            expect(errors.length).toBe(0);
        });

        it("mutually recursive rules converge without stack overflow", () => {
            // <A> and <B> reference each other
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<A>) -> { actionName: "play", trackName: track };
                <A> = $(x:string) | next $(y:<B>);
                <B> = $(x:string) | back $(y:<A>);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // Both <A> and <B> should infer as string (from the base case)
            expect(errors.length).toBe(0);
        });

        it("structurally recursive rule with type mismatch reports error", () => {
            const NumActionDef = SchemaCreator.intf(
                "NumAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    level: SchemaCreator.field(SchemaCreator.number()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "NumAction" ? NumActionDef : undefined;

            // <Tree> is recursive: string | { inner: <Tree> }
            // level expects number, but <Tree> produces string or object
            const grammarText = `
                import { NumAction } from "schema.ts";
                <Start> : NumAction = set $(level:<Tree>) -> { actionName: "test", level };
                <Tree> = $(x:string) | wrap $(y:<Tree>) -> { inner: y };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(1);
        });

        it("degenerate self-reference is caught by grammar compiler", () => {
            // <A> = <A> is a pure self-reference with no base case.
            // The grammar compiler catches this as an epsilon-reachable cycle
            // before type inference even runs.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<A>) -> { actionName: "play", trackName: track };
                <A> = <A>;
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("epsilon-reachable cycle");
        });

        it("mutually recursive passthrough with type mismatch reports error", () => {
            const NumActionDef = SchemaCreator.intf(
                "NumAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    level: SchemaCreator.field(SchemaCreator.number()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "NumAction" ? NumActionDef : undefined;

            // <A> and <B> mutually recurse, both produce string base case.
            // level expects number — should report a type mismatch.
            const grammarText = `
                import { NumAction } from "schema.ts";
                <Start> : NumAction = set $(level:<A>) -> { actionName: "test", level };
                <A> = $(x:string) | next $(y:<B>);
                <B> = $(x:string) | back $(y:<A>);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected number");
        });

        it("mutually structurally recursive rules produce valid types", () => {
            // <A> and <B> reference each other inside objects — structural mutual recursion.
            // A = string | { inner: B }
            // B = string | { inner: A }
            const TreeActionDef = SchemaCreator.intf(
                "TreeAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("tree"),
                    ),
                    data: SchemaCreator.field(SchemaCreator.any()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "TreeAction" ? TreeActionDef : undefined;

            const grammarText = `
                import { TreeAction } from "schema.ts";
                <Start> : TreeAction = show $(data:<A>) -> { actionName: "tree", data };
                <A> = $(x:string) | wrap $(y:<B>) -> { inner: y };
                <B> = $(x:string) | wrap $(y:<A>) -> { inner: y };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            // Should compile without errors — both recursive types are valid
            expect(errors.length).toBe(0);
        });

        it("chain of three mutually passthrough-recursive rules converge", () => {
            // <A> -> <B> -> <C> -> <A> forms a 3-rule passthrough cycle.
            // All should resolve to string from their base cases.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<A>) -> { actionName: "play", trackName: track };
                <A> = $(x:string) | next $(y:<B>);
                <B> = $(x:string) | next $(y:<C>);
                <C> = $(x:string) | next $(y:<A>);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("chain of three mutually passthrough-recursive rules with type mismatch", () => {
            const NumActionDef = SchemaCreator.intf(
                "NumAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    level: SchemaCreator.field(SchemaCreator.number()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "NumAction" ? NumActionDef : undefined;

            // Chain of 3 rules all producing string, but level expects number
            const grammarText = `
                import { NumAction } from "schema.ts";
                <Start> : NumAction = set $(level:<A>) -> { actionName: "test", level };
                <A> = $(x:string) | next $(y:<B>);
                <B> = $(x:string) | next $(y:<C>);
                <C> = $(x:string) | next $(y:<A>);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected number");
        });
    });

    describe("Structural type equality and union derivation", () => {
        it("alternatives producing same object structure are treated as equal", () => {
            // Both alternatives produce { actionName: "pause" } — should unify
            const grammarText = `
                import { PauseAction } from "schema.ts";
                <Start> : PauseAction = <PauseA> | <PauseB>;
                <PauseA> = pause -> { actionName: "pause" };
                <PauseB> = stop -> { actionName: "pause" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("sub-rule alternatives with same string type unify correctly", () => {
            // Both alternatives of <Name> produce string — should unify
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(track:<Name>) -> { actionName: "play", trackName: track };
                <Name> = $(x:wildcard) | $(x:string);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("sub-rule alternatives with different types derive union", () => {
            // <Mixed> alternatives produce string and number — derives union
            // Since PlayAction.trackName expects string, putting a union
            // (string | number) in a string field should cause an error
            const NumActionDef = SchemaCreator.intf(
                "NumAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    level: SchemaCreator.field(SchemaCreator.number()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "NumAction" ? NumActionDef : undefined;

            const grammarText = `
                import { NumAction } from "schema.ts";
                <Start> : NumAction = set $(level:<Mixed>) -> { actionName: "test", level };
                <Mixed> = $(x:number) | $(x:string);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            // <Mixed> produces number|string union, field expects number — error
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected number");
        });

        it("action type without parameters matches value without parameters", () => {
            // Type has no parameters field, value has no parameters — should match
            const SimpleActionDef = SchemaCreator.intf(
                "SimpleAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("simple"),
                    ),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "SimpleAction" ? SimpleActionDef : undefined;

            const grammarText = `
                import { SimpleAction } from "schema.ts";
                <Start> : SimpleAction = do it -> { actionName: "simple" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(0);
        });

        it("action type without parameters rejects value with extra parameters", () => {
            const SimpleActionDef = SchemaCreator.intf(
                "SimpleAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("simple"),
                    ),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "SimpleAction" ? SimpleActionDef : undefined;

            const grammarText = `
                import { SimpleAction } from "schema.ts";
                <Start> : SimpleAction = do it -> { actionName: "simple", parameters: {} };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("Extraneous property");
            expect(errors[0]).toContain("parameters");
        });

        it("structurally identical types with different names match via type-reference", () => {
            // Two different type names that resolve to structurally identical types
            const TypeA = SchemaCreator.intf(
                "TypeA",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    value: SchemaCreator.field(SchemaCreator.string()),
                }),
                undefined,
                true,
            );
            const TypeB = SchemaCreator.intf(
                "TypeB",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    value: SchemaCreator.field(SchemaCreator.string()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) => {
                if (typeName === "TypeA") return TypeA;
                if (typeName === "TypeB") return TypeB;
                return undefined;
            };

            // Both sub-rules produce identical structures, just imported
            // under different type names — should unify without error
            const grammarText = `
                import { TypeA } from "schema.ts";
                import { TypeB } from "schema.ts";
                <Start> : TypeA | TypeB =
                    do $(v:string) -> { actionName: "test", value: v };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(0);
        });

        it("boolean field validates correctly", () => {
            const BoolActionDef = SchemaCreator.intf(
                "BoolAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("toggle"),
                    ),
                    enabled: SchemaCreator.field(SchemaCreator.boolean()),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "BoolAction" ? BoolActionDef : undefined;

            const grammarText = `
                import { BoolAction } from "schema.ts";
                <Start> : BoolAction =
                    enable -> { actionName: "toggle", enabled: true }
                  | disable -> { actionName: "toggle", enabled: false };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(0);
        });

        it("string union field with wrong literal produces error", () => {
            const ModeActionDef = SchemaCreator.intf(
                "ModeAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("setMode"),
                    ),
                    mode: SchemaCreator.field(
                        SchemaCreator.string("fast", "slow"),
                    ),
                }),
                undefined,
                true,
            );
            const loader: SchemaLoader = (typeName) =>
                typeName === "ModeAction" ? ModeActionDef : undefined;

            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Start> : ModeAction = set mode to turbo -> { actionName: "setMode", mode: "turbo" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: loader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("'turbo'");
        });
    });

    describe("expression type inference", () => {
        // Schema: { actionName: string, count: number, label: string, active: boolean }
        const ExprActionDef = SchemaCreator.intf(
            "ExprAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                count: SchemaCreator.field(SchemaCreator.number()),
                label: SchemaCreator.field(SchemaCreator.string()),
                active: SchemaCreator.field(SchemaCreator.boolean()),
            }),
            undefined,
            true,
        );
        const exprLoader: SchemaLoader = (typeName) =>
            typeName === "ExprAction" ? ExprActionDef : undefined;
        const exprOpts = {
            schemaLoader: exprLoader,
            enableExpressions: true,
        };

        it("template literal inferred as string - valid in string field", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: \`hello \${name}\`, active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("template literal in number field produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: \`hello \${name}\`, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected number");
        });

        it("arithmetic expression inferred as number", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: n * 2, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("arithmetic expression in string field produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: n * 2, active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected string");
        });

        it("comparison expression inferred as boolean", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: n, label: "x", active: n > 0 };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("comparison in number field produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: n > 0, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected number");
        });

        it("typeof inferred as string", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(x:string)
                    -> { actionName: "test", count: 0, label: typeof x, active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("negation (!) inferred as boolean", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(x:string)
                    -> { actionName: "test", count: 0, label: "x", active: !x };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("unary minus inferred as number", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: -n, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("ternary with same-type branches inferred correctly", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: n > 0 ? n : 0, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("string + anything inferred as string", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: "count: " + n, active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("toLowerCase inferred as string", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: name.toLowerCase(), active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("indexOf on string inferred as number", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: name.indexOf("x"), label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("includes on string inferred as boolean", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: "x", active: name.includes("y") };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("string length property inferred as number", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: name.length, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("array filter inferred as same array type", () => {
            // items is an array; filter returns the same array type
            // We test that it doesn't produce a type error when used properly
            const ArrayActionDef = SchemaCreator.intf(
                "ArrayAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    items: SchemaCreator.field(
                        SchemaCreator.array(SchemaCreator.string()),
                    ),
                }),
                undefined,
                true,
            );
            const arrayLoader: SchemaLoader = (typeName) =>
                typeName === "ArrayAction" ? ArrayActionDef : undefined;
            const grammarText = `
                import { ArrayAction } from "schema.ts";
                <Start> : ArrayAction = test $(name:string)
                    -> { actionName: "test", items: [name].filter(name) };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: arrayLoader,
                enableExpressions: true,
            });
            expect(errors.length).toBe(0);
        });

        it("array includes inferred as boolean", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: "x", active: ["a", "b"].includes(name) };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("array join inferred as string", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: ["a", name].join(", "), active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("array indexOf inferred as number", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: ["a", "b"].indexOf(name), label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("number toFixed inferred as string", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: n.toFixed(2), active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(0);
        });

        it("number toFixed in number field produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: n.toFixed(2), label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("expected number");
        });

        it("array literal element types are inferred", () => {
            const ArrayActionDef = SchemaCreator.intf(
                "ArrayAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    items: SchemaCreator.field(
                        SchemaCreator.array(SchemaCreator.string()),
                    ),
                }),
                undefined,
                true,
            );
            const arrayLoader: SchemaLoader = (typeName) =>
                typeName === "ArrayAction" ? ArrayActionDef : undefined;
            const grammarText = `
                import { ArrayAction } from "schema.ts";
                <Start> : ArrayAction = test $(name:string)
                    -> { actionName: "test", items: [name, "literal"] };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: arrayLoader,
                enableExpressions: true,
            });
            expect(errors.length).toBe(0);
        });

        it("split returns string array", () => {
            const ArrayActionDef = SchemaCreator.intf(
                "ArrayAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    items: SchemaCreator.field(
                        SchemaCreator.array(SchemaCreator.string()),
                    ),
                }),
                undefined,
                true,
            );
            const arrayLoader: SchemaLoader = (typeName) =>
                typeName === "ArrayAction" ? ArrayActionDef : undefined;
            const grammarText = `
                import { ArrayAction } from "schema.ts";
                <Start> : ArrayAction = test $(name:string)
                    -> { actionName: "test", items: name.split(",") };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: arrayLoader,
                enableExpressions: true,
            });
            expect(errors.length).toBe(0);
        });
    });
});
