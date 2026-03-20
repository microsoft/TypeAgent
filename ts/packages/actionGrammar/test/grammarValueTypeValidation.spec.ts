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
});
