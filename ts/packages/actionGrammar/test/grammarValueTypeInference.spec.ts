// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import { SchemaCreator } from "@typeagent/action-schema";
import type { SchemaLoader } from "../src/grammarCompiler.js";
import { mockSchemaLoader } from "./validationTestHelpers.js";

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
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("tree")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("tree")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("simple")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("simple")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                value: SchemaCreator.field(SchemaCreator.string()),
            }),
            undefined,
            true,
        );
        const TypeB = SchemaCreator.intf(
            "TypeB",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
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
                actionName: SchemaCreator.field(SchemaCreator.string("toggle")),
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
                mode: SchemaCreator.field(SchemaCreator.string("fast", "slow")),
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
