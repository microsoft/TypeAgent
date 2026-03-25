// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import { SchemaCreator } from "@typeagent/action-schema";
import type { SchemaLoader } from "../src/grammarCompiler.js";
import { mockSchemaLoader } from "./validationTestHelpers.js";

describe("Value type validation", () => {
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
});
