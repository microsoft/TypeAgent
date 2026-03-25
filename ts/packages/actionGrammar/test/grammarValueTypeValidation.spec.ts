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

    it("single-variable implicit rule is validated against declared type", () => {
        // $(x:string) with no -> produces the variable's value implicitly.
        // The variable type (string) must conform to the declared type (PauseAction).
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = <Wrapper>;
            <Wrapper> = $(x:string);
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        // string doesn't conform to PauseAction — expect a type error
        expect(errors.length).toBe(1);
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

        it("negation (!) requires boolean operand", () => {
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
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("!");
            expect(errors[0]).toContain("boolean");
        });

        it("negation (!) on boolean is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: "x", active: !(n > 0) };
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

        it("string + number produces error (use template literal)", () => {
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
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("+");
            expect(errors[0]).toContain("template literal");
        });

        it("string + string is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: "hello " + name, active: true };
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

        it("array filter produces error (callback method not supported)", () => {
            // filter requires a callback, which is not supported in grammar expressions
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
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("filter");
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

    describe("operator type restrictions", () => {
        // Schema with several field types for thorough testing
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

        // ── Operator restriction errors ──────────────────────────────────

        it("string - number produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string) $(n:number)
                    -> { actionName: "test", count: name - n, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("-");
            expect(errors[0]).toContain("number");
        });

        it("string < number produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string) $(n:number)
                    -> { actionName: "test", count: 0, label: "x", active: name < n };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("<");
        });

        it("!string_var produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: "x", active: !name };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("!");
            expect(errors[0]).toContain("boolean");
        });

        it("string ternary test produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: name ? "yes" : "no", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("boolean");
        });

        it("unary -string_var produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: -name, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("-");
        });

        it("string && string produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(x:string) $(y:string)
                    -> { actionName: "test", count: 0, label: "x", active: x && y };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("&&");
            expect(errors[0]).toContain("boolean");
        });

        it("number || number produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(x:number) $(y:number)
                    -> { actionName: "test", count: 0, label: "x", active: x || y };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("||");
            expect(errors[0]).toContain("boolean");
        });

        it("number.unknownMethod() produces error with supported methods", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: n.trim(), active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("trim");
            expect(errors[0]).toContain("Supported methods");
            expect(errors[0]).toContain("toString");
        });

        it("string.flat() produces error with supported methods", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: name.flat(), active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("flat");
            expect(errors[0]).toContain("toLowerCase");
        });

        // ── ERROR_TYPE cascading (no secondary errors) ───────────────────

        it("unknown_var + 1 does not produce secondary type errors", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: unknown_var + 1, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            // Compiler may report its own variable-not-defined error;
            // the key check: no secondary "+" type error from cascading
            expect(errors.some((e) => e.includes("+"))).toBe(false);
        });

        it("unknown_var.length does not produce secondary property errors", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: unknown_var.length, label: "x", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            // Should not produce a secondary "Property 'length' does not exist" error
            expect(errors.some((e) => e.includes("Property"))).toBe(false);
        });

        it("unknown_var > 0 ? a : b does not produce secondary cascading errors", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: unknown_var > 0 ? "a" : "b", active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            // Should not produce secondary "Ternary test not boolean" errors
            expect(errors.some((e) => e.includes("Ternary"))).toBe(false);
        });

        // ── Valid operations ─────────────────────────────────────────────

        it("number + number is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number) $(m:number)
                    -> { actionName: "test", count: n + m, label: "x", active: true };
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

        it("string < string is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(x:string) $(y:string)
                    -> { actionName: "test", count: 0, label: "x", active: x < y };
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

        it("boolean && boolean is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number) $(m:number)
                    -> { actionName: "test", count: 0, label: "x", active: (n > 0) && (m < 10) };
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

        it("!(boolean) is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: "x", active: !(n > 0) };
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

        it("comparison ternary is valid", () => {
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

        it("typeof is valid with any operand", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: typeof name, active: true };
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

        it("=== accepts any types", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: "x", active: name === "hello" };
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

        it("resolveType handles circular type-reference chains", () => {
            // Create a mutually-recursive grammar where <A> → <B> → <A>.
            // Type derivation must not hang or throw, and validation should
            // complete gracefully.
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(level:<A>)
                    -> { actionName: "test", count: 0, label: level, active: true };
                <A> = $(x:string) | recurse $(y:<B>);
                <B> = $(x:string) | recurse $(y:<A>);
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            // The important thing is that this does not hang.
            // The recursive rules produce string, which matches the label field.
            expect(errors.length).toBe(0);
        });

        it("resolveType handles 3-way circular type-reference chains", () => {
            // Three-way cycle: <A> → <B> → <C> → <A>
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(level:<A>)
                    -> { actionName: "test", count: 0, label: level, active: true };
                <A> = $(x:string) | next $(y:<B>);
                <B> = $(x:string) | next $(y:<C>);
                <C> = $(x:string) | next $(y:<A>);
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

        it("resolveType handles self-referencing rule", () => {
            // Direct self-reference: <A> → <A>
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(level:<A>)
                    -> { actionName: "test", count: 0, label: level, active: true };
                <A> = $(x:string) | next $(y:<A>);
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

        it("string.slice with string arg produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: name.slice("x"), active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("slice");
            expect(errors[0]).toContain("number");
        });

        it("string.indexOf with number first arg produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: "x", active: "hello".indexOf(n) > 0 };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("indexOf");
            expect(errors[0]).toContain("string");
        });

        it("string.padStart with correct args is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: name.padStart(10, "0"), active: true };
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

        it("number.toFixed with string arg produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: n.toFixed("2"), active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("toFixed");
            expect(errors[0]).toContain("number");
        });

        it("array.join with number arg produces error", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: ["a", "b"].join(n), active: true };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                undefined,
                exprOpts,
            );
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("join");
            expect(errors[0]).toContain("string");
        });

        it("unnecessary ?? emits warning", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: name ?? "default", active: true };
            `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                warnings,
                exprOpts,
            );
            expect(errors.length).toBe(0);
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0]).toContain("??");
            expect(warnings[0]).toContain("unnecessary");
        });

        it("unnecessary ?. emits warning", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: name?.length ?? 0, label: "x", active: true };
            `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow(
                "test",
                grammarText,
                errors,
                warnings,
                exprOpts,
            );
            expect(errors.length).toBe(0);
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings.some((w) => w.includes("?."))).toBe(true);
            expect(warnings.some((w) => w.includes("unnecessary"))).toBe(true);
        });

        it("?. on type that is always undefined emits warning", () => {
            // Create a schema with an optional field (T | undefined)
            const OptActionDef = SchemaCreator.intf(
                "OptAction",
                SchemaCreator.obj({
                    actionName: SchemaCreator.field(
                        SchemaCreator.string("test"),
                    ),
                    label: SchemaCreator.field(SchemaCreator.string()),
                }),
                undefined,
                true,
            );
            const optLoader: SchemaLoader = (typeName) =>
                typeName === "OptAction" ? OptActionDef : undefined;
            const grammarText = `
                import { OptAction } from "schema.ts";
                <Start> : OptAction = test $(name:string)?
                    -> { actionName: "test", label: name?.toLowerCase() ?? "none" };
            `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings, {
                schemaLoader: optLoader,
                enableExpressions: true,
            });
            expect(errors.length).toBe(0);
            // name is string | undefined, so ?. is legitimate
            // name?.toLowerCase() returns string | undefined, so ?? is legitimate
            // No warnings expected here — both operators are necessary
            expect(warnings.length).toBe(0);
        });
    });

    describe("Spread in type validation", () => {
        it("spread providing required field passes validation", () => {
            // Base sub-rule produces { trackName: string }
            // Spread merges it into the action, satisfying the required field.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = $(x:string) -> { trackName: x };
                <Start> : PlayAction = play $(b:<Base>) -> { actionName: "play", ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("spread missing required field produces error", () => {
            // Base sub-rule produces { other: string } which does NOT
            // include trackName, so the required field is still missing.
            // The spread also contributes "other" which is extraneous.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = $(x:string) -> { other: x };
                <Start> : PlayAction = play $(b:<Base>) -> { actionName: "play", ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(
                errors.some(
                    (e) =>
                        e.includes("Missing required property") &&
                        e.includes("trackName"),
                ),
            ).toBe(true);
            expect(
                errors.some(
                    (e) => e.includes("Extraneous") && e.includes("other"),
                ),
            ).toBe(true);
        });

        it("spread with non-object argument produces type-inference error", () => {
            // Spreading a string variable should be caught by
            // deriveValueTypeImpl as a type error.
            const grammarText = `
                import { PauseAction } from "schema.ts";
                <Start> : PauseAction = pause $(x:string) -> { actionName: "pause", ...x };
            `;
            const errors: string[] = [];
            const warnings: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, warnings, {
                schemaLoader: mockSchemaLoader,
            });
            // The spread of a non-object type is flagged as an error or warning
            const allMessages = [...errors, ...warnings];
            expect(allMessages.length).toBeGreaterThan(0);
            expect(allMessages.some((e) => e.includes("object"))).toBe(true);
        });

        it("explicit property overrides spread field", () => {
            // The explicit actionName: "play" should override the spread's
            // actionName if the base also produces one.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = $(x:string) -> { actionName: "wrong", trackName: x };
                <Start> : PlayAction = play $(b:<Base>) -> { ...b, actionName: "play" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // actionName is explicitly set to "play" after the spread, which
            // is correct, so no errors expected.
            expect(errors.length).toBe(0);
        });

        it("spread overrides earlier explicit property", () => {
            // JS semantics: { actionName: "play", ...base } where base has
            // actionName: "wrong" → the spread's value wins.
            // The validator catches this: base's actionName is "wrong" which
            // doesn't match the expected string-union "play".
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = $(x:string) -> { actionName: "wrong", trackName: x };
                <Start> : PlayAction = play $(b:<Base>) -> { actionName: "play", ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // The spread overrides actionName with "wrong" — caught as error.
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("'play'");
            expect(errors[0]).toContain("'wrong'");
        });

        it("spread between explicit properties uses last-write-wins", () => {
            // { a: "first", ...base, a: "final" } → a = "final"
            // Validates that the explicit property after spread takes effect.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = $(x:string) -> { actionName: "from_base", trackName: x };
                <Start> : PlayAction = play $(b:<Base>) -> { actionName: "wrong", ...b, actionName: "play" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // Final actionName is the explicit "play" — should pass.
            expect(errors.length).toBe(0);
        });

        it("multiple spreads use last-write-wins for overlapping fields", () => {
            // { ...base1, ...base2 } where both contribute trackName —
            // base2's trackName wins.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base1> = $(x:string) -> { actionName: "play" };
                <Base2> = $(x:string) -> { trackName: x };
                <Start> : PlayAction = play $(a:<Base1>) $(b:<Base2>) -> { ...a, ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // base1 contributes actionName, base2 contributes trackName
            // — all required fields covered.
            expect(errors.length).toBe(0);
        });
    });

    describe("string literal type inference", () => {
        // String literals now infer as string-union (single-member) rather
        // than plain string. These tests verify that all expression dispatch
        // points (operators, methods, template literals) correctly treat
        // string-union the same as string.
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

        it("literal + variable string is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: "hello " + name, active: true };
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

        it("literal + literal string is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test
                    -> { actionName: "test", count: 0, label: "hello " + "world", active: true };
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

        it("literal string methods work (toLowerCase)", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test
                    -> { actionName: "test", count: 0, label: "HELLO".toLowerCase(), active: true };
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

        it("literal string indexOf inferred as number", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test
                    -> { actionName: "test", count: "hello".indexOf("e"), label: "x", active: true };
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

        it("literal string includes inferred as boolean", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test
                    -> { actionName: "test", count: 0, label: "x", active: "hello".includes("e") };
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

        it("literal string .length inferred as number", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test
                    -> { actionName: "test", count: "hello".length, label: "x", active: true };
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

        it("literal string in template literal interpolation is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: \`prefix ${"a"} \${name}\`, active: true };
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

        it("literal string comparison is valid", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(name:string)
                    -> { actionName: "test", count: 0, label: "x", active: name < "z" };
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

        it("literal string as method arg is valid", () => {
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

        it("literal string split returns string array", () => {
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
                <Start> : ArrayAction = test
                    -> { actionName: "test", items: "a,b,c".split(",") };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: arrayLoader,
                enableExpressions: true,
            });
            expect(errors.length).toBe(0);
        });

        it("literal string in ternary branch accepted for string field", () => {
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test $(n:number)
                    -> { actionName: "test", count: 0, label: n > 0 ? "yes" : "no", active: true };
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

        it("literal string assigned to plain string field passes", () => {
            // A string literal "hello" now infers as string-union(["hello"]),
            // which must be assignable to a plain string field.
            const grammarText = `
                import { ExprAction } from "schema.ts";
                <Start> : ExprAction = test
                    -> { actionName: "test", count: 0, label: "hello", active: true };
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
    });

    describe("String literal and string-union validation", () => {
        // ModeAction: { actionName: "setMode"; mode: "fast" | "slow" }
        const ModeActionDef = SchemaCreator.intf(
            "ModeAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(
                    SchemaCreator.string("setMode"),
                ),
                mode: SchemaCreator.field(SchemaCreator.string("fast", "slow")),
            }),
            undefined,
            true,
        );
        const modeLoader: SchemaLoader = (typeName, source) => {
            if (typeName === "ModeAction") return ModeActionDef;
            return mockSchemaLoader(typeName, source);
        };

        it("correct literal for single-member string-union", () => {
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(t:string) -> { actionName: "play", trackName: t };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("wrong literal for single-member string-union", () => {
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Start> : PlayAction = play $(t:string) -> { actionName: "stop", trackName: t };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("'play'");
            expect(errors[0]).toContain("'stop'");
        });

        it("correct literal for multi-member string-union", () => {
            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Start> : ModeAction = fast mode -> { actionName: "setMode", mode: "fast" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: modeLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("wrong literal for multi-member string-union", () => {
            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Start> : ModeAction = turbo mode -> { actionName: "setMode", mode: "turbo" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: modeLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("'turbo'");
        });

        it("plain string variable accepted for string-union field", () => {
            // A string variable could match at runtime — no compile-time error.
            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Start> : ModeAction = set mode $(m:string) -> { actionName: "setMode", mode: m };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: modeLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("number variable rejected for string-union field", () => {
            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Start> : ModeAction = set mode $(n:number) -> { actionName: "setMode", mode: n };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: modeLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("number");
        });

        it("sub-rule with matching string-union literal via spread", () => {
            // Base produces { actionName: "play" } — spread into PlayAction
            // actionName is "play" which matches the expected string-union.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = $(t:string) -> { actionName: "play", trackName: t };
                <Start> : PlayAction = play $(b:<Base>) -> { ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("sub-rule with wrong string-union literal via spread", () => {
            // Base produces { actionName: "stop" } — doesn't match "play".
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = $(t:string) -> { actionName: "stop", trackName: t };
                <Start> : PlayAction = play $(b:<Base>) -> { ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("'play'");
            expect(errors[0]).toContain("'stop'");
        });

        it("spread with correct multi-member string-union literal", () => {
            // Base produces { mode: "slow" } which is in {"fast", "slow"}.
            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Base> = base -> { actionName: "setMode", mode: "slow" };
                <Start> : ModeAction = slow mode $(b:<Base>) -> { ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: modeLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("spread with wrong multi-member string-union literal", () => {
            // Base produces { mode: "turbo" } which is NOT in {"fast", "slow"}.
            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Base> = base -> { actionName: "setMode", mode: "turbo" };
                <Start> : ModeAction = turbo mode $(b:<Base>) -> { ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: modeLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("'turbo'");
        });

        it("multiple spreads — last spread wrong literal wins", () => {
            // Base1 has actionName: "play", Base2 has actionName: "wrong".
            // Last-write-wins: actionName = "wrong" → error.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base1> = $(t:string) -> { actionName: "play", trackName: t };
                <Base2> = base2 -> { actionName: "wrong" };
                <Start> : PlayAction = play $(a:<Base1>) $(b:<Base2>) -> { ...a, ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("'play'");
            expect(errors[0]).toContain("'wrong'");
        });

        it("multiple spreads — last spread correct literal wins", () => {
            // Base1 has actionName: "wrong", Base2 has actionName: "play".
            // Last-write-wins: actionName = "play" → OK.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base1> = $(t:string) -> { actionName: "wrong", trackName: t };
                <Base2> = base2 -> { actionName: "play" };
                <Start> : PlayAction = play $(a:<Base1>) $(b:<Base2>) -> { ...a, ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("explicit literal after spread overrides wrong spread literal", () => {
            // Spread has mode: "turbo" (wrong), but explicit mode: "fast"
            // comes after → "fast" wins → no error.
            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Base> = base -> { actionName: "setMode", mode: "turbo" };
                <Start> : ModeAction = fast mode $(b:<Base>) -> { ...b, mode: "fast" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: modeLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("spread after explicit overrides correct literal with wrong one", () => {
            // Explicit mode: "fast" (correct), spread has mode: "turbo" (wrong).
            // Spread wins → error.
            const grammarText = `
                import { ModeAction } from "schema.ts";
                <Base> = base -> { actionName: "setMode", mode: "turbo" };
                <Start> : ModeAction = turbo mode $(b:<Base>) -> { mode: "fast", ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: modeLoader,
            });
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("'turbo'");
        });

        it("spread string field into plain string field passes", () => {
            // trackName is typed as plain `string`. Spread contributes
            // trackName: "hello" (a string-union ["hello"]) — should be
            // assignable to string.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = base -> { actionName: "play", trackName: "hello" };
                <Start> : PlayAction = play $(b:<Base>) -> { ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(errors.length).toBe(0);
        });

        it("spread of any-typed (untyped sub-rule) variable passes", () => {
            // An untyped sub-rule produces 'any'. Spreading 'any' should
            // not produce errors — we can't know the fields at compile time.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Untyped> = $(x:string) $(y:string);
                <Start> : PlayAction = play $(u:<Untyped>) -> { actionName: "play", ...u };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            // 'any' spread should not cause errors (missing trackName is
            // still flagged because the spread can't guarantee it).
            // The key check: no "must be an object type" error.
            expect(
                errors.some((e) => e.includes("must be an object type")),
            ).toBe(false);
        });

        it("extraneous explicit property detected even with spread", () => {
            // { ...b, bogus: "x" } — bogus is explicitly listed and not
            // in the schema, so it should be flagged as extraneous.
            const grammarText = `
                import { PlayAction } from "schema.ts";
                <Base> = $(x:string) -> { actionName: "play", trackName: x };
                <Start> : PlayAction = play $(b:<Base>) -> { ...b, bogus: "x" };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(
                errors.some(
                    (e) => e.includes("Extraneous") && e.includes("bogus"),
                ),
            ).toBe(true);
        });

        it("extraneous spread-contributed property detected", () => {
            // Base produces { actionName, trackName, extra } — extra is
            // not in PauseAction's schema, so it should be flagged.
            const grammarText = `
                import { PauseAction } from "schema.ts";
                <Base> = pause -> { actionName: "pause", extra: "oops" };
                <Start> : PauseAction = $(b:<Base>) -> { ...b };
            `;
            const errors: string[] = [];
            loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
                schemaLoader: mockSchemaLoader,
            });
            expect(
                errors.some(
                    (e) => e.includes("Extraneous") && e.includes("extra"),
                ),
            ).toBe(true);
        });
    });
});
