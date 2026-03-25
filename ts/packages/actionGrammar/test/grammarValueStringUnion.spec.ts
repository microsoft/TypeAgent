// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import { SchemaCreator } from "@typeagent/action-schema";
import type { SchemaLoader } from "../src/grammarCompiler.js";
import { mockSchemaLoader } from "./validationTestHelpers.js";

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
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
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
            actionName: SchemaCreator.field(SchemaCreator.string("setMode")),
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
        expect(errors.some((e) => e.includes("must be an object type"))).toBe(
            false,
        );
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
            errors.some((e) => e.includes("Extraneous") && e.includes("bogus")),
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
            errors.some((e) => e.includes("Extraneous") && e.includes("extra")),
        ).toBe(true);
    });
});

describe("Cross-field string-union assignments", () => {
    // These tests verify that the string literal → string-union inference
    // (commit 3 of the spread branch) correctly handles cross-field
    // assignments where both sides are string literals with different values.

    // TwoFieldAction: { actionName: "test"; field1: "a" | "b"; field2: "c" | "d" }
    const TwoFieldActionDef = SchemaCreator.intf(
        "TwoFieldAction",
        SchemaCreator.obj({
            actionName: SchemaCreator.field(SchemaCreator.string("test")),
            field1: SchemaCreator.field(SchemaCreator.string("a", "b")),
            field2: SchemaCreator.field(SchemaCreator.string("c", "d")),
        }),
        undefined,
        true,
    );
    const twoFieldLoader: SchemaLoader = (typeName) =>
        typeName === "TwoFieldAction" ? TwoFieldActionDef : undefined;

    it("different string literals in disjoint enum fields pass", () => {
        // field1: "a" and field2: "c" — both valid for their respective unions
        const grammarText = `
            import { TwoFieldAction } from "schema.ts";
            <Start> : TwoFieldAction = test -> { actionName: "test", field1: "a", field2: "c" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: twoFieldLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("wrong literal for one field while other is correct", () => {
        // field1: "a" is valid, field2: "a" is NOT in {"c", "d"} — error
        const grammarText = `
            import { TwoFieldAction } from "schema.ts";
            <Start> : TwoFieldAction = test -> { actionName: "test", field1: "a", field2: "a" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: twoFieldLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("'a'");
    });

    it("wrong literals for both fields produce two errors", () => {
        // field1: "c" is NOT in {"a", "b"}, field2: "a" is NOT in {"c", "d"}
        const grammarText = `
            import { TwoFieldAction } from "schema.ts";
            <Start> : TwoFieldAction = test -> { actionName: "test", field1: "c", field2: "a" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: twoFieldLoader,
        });
        expect(errors.length).toBe(2);
    });

    it("same literal valid in two fields with overlapping enums", () => {
        // OverlapAction: both fields accept "shared"
        const OverlapActionDef = SchemaCreator.intf(
            "OverlapAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                field1: SchemaCreator.field(
                    SchemaCreator.string("shared", "a"),
                ),
                field2: SchemaCreator.field(
                    SchemaCreator.string("shared", "b"),
                ),
            }),
            undefined,
            true,
        );
        const overlapLoader: SchemaLoader = (typeName) =>
            typeName === "OverlapAction" ? OverlapActionDef : undefined;

        const grammarText = `
            import { OverlapAction } from "schema.ts";
            <Start> : OverlapAction = test -> { actionName: "test", field1: "shared", field2: "shared" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: overlapLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("string literal assignable to plain string field", () => {
        // A string literal "hello" infers as string-union(["hello"]).
        // It must still be assignable to a plain `string` field.
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play -> { actionName: "play", trackName: "hello" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("ternary with different literal branches assignable to plain string", () => {
        // Both branches are different literals: "yes" and "no".
        // The ternary result (string-union) must be assignable to a plain string field.
        const ExprActionDef = SchemaCreator.intf(
            "ExprAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                label: SchemaCreator.field(SchemaCreator.string()),
            }),
            undefined,
            true,
        );
        const exprLoader: SchemaLoader = (typeName) =>
            typeName === "ExprAction" ? exprActionDef : undefined;
        const exprActionDef = ExprActionDef;

        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", label: n > 0 ? "yes" : "no" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: exprLoader,
            enableExpressions: true,
        });
        expect(errors.length).toBe(0);
    });

    it("sub-rule producing specific literal passes for matching enum field", () => {
        // <ModeRule> produces "fast" which is in {"fast", "slow"}.
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
        const modeLoader: SchemaLoader = (typeName) =>
            typeName === "ModeAction" ? ModeActionDef : undefined;

        const grammarText = `
            import { ModeAction } from "schema.ts";
            <ModeRule> = fast -> "fast";
            <Start> : ModeAction = set $(m:<ModeRule>) -> { actionName: "setMode", mode: m };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: modeLoader,
        });
        expect(errors.length).toBe(0);
    });

    it("sub-rule producing wrong literal fails for non-matching enum field", () => {
        // <ModeRule> produces "turbo" which is NOT in {"fast", "slow"}.
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
        const modeLoader: SchemaLoader = (typeName) =>
            typeName === "ModeAction" ? ModeActionDef : undefined;

        const grammarText = `
            import { ModeAction } from "schema.ts";
            <ModeRule> = turbo -> "turbo";
            <Start> : ModeAction = set $(m:<ModeRule>) -> { actionName: "setMode", mode: m };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: modeLoader,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("'turbo'");
    });
});
