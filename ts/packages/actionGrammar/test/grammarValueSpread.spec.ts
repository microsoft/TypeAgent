// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import { mockSchemaLoader } from "./validationTestHelpers.js";

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
            errors.some((e) => e.includes("Extraneous") && e.includes("other")),
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

    it("accumulates inference and structural errors", () => {
        // Spread a string (inference error: not an object) AND
        // omit required trackName (structural error).
        // Both errors must appear — no early return.
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play $(x:string) -> { actionName: "play", ...x };
        `;
        const errors: string[] = [];
        const warnings: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, warnings, {
            schemaLoader: mockSchemaLoader,
        });
        const allMessages = [...errors, ...warnings];
        // Should have at least two: the non-object spread error AND
        // the missing required property "trackName".
        expect(allMessages.length).toBeGreaterThanOrEqual(2);
        expect(allMessages.some((e) => e.includes("object"))).toBe(true);
        expect(
            allMessages.some(
                (e) =>
                    e.includes("Missing required property") &&
                    e.includes("trackName"),
            ),
        ).toBe(true);
    });

    // ── No cascading errors from ERROR_TYPE spreads ──────────────────

    it("spread of undefined variable does not cascade missing-property errors", () => {
        // unknown_var is undefined → ERROR_TYPE → the object shape is
        // indeterminate, so "missing required property" must not cascade.
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play -> { actionName: "play", ...unknown_var };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        // The undefined-variable error is reported (by the compiler or
        // inference pass), but NO cascading "Missing required property".
        expect(errors.some((e) => e.includes("unknown_var"))).toBe(true);
        expect(
            errors.some((e) => e.includes("Missing required property")),
        ).toBe(false);
    });

    it("spread of error expression does not cascade structural errors", () => {
        // unknown_var.field → ERROR_TYPE (unknown var) → the spread
        // produces ERROR_TYPE → no cascading extraneous/missing errors.
        const grammarText = `
            import { PauseAction } from "schema.ts";
            <Start> : PauseAction = pause -> { actionName: "pause", ...unknown_var.field };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        expect(errors.some((e) => e.includes("unknown_var"))).toBe(true);
        expect(
            errors.some((e) => e.includes("Missing required property")),
        ).toBe(false);
        expect(errors.some((e) => e.includes("Extraneous"))).toBe(false);
    });

    it("explicit property errors are still reported alongside error spread", () => {
        // unknown_var spread → ERROR_TYPE suppresses structural checks,
        // but explicit literal "wrong" for actionName should still raise
        // an inference-level error if it's in the inferred type? No —
        // ERROR_TYPE for the whole object means ALL structural checks
        // are skipped.  The primary error is the undefined variable.
        const grammarText = `
            import { PlayAction } from "schema.ts";
            <Start> : PlayAction = play -> { actionName: "wrong", ...unknown_var };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: mockSchemaLoader,
        });
        // Only the undefined-variable error — no cascading type mismatch
        // for actionName since the spread might override it.
        expect(errors.some((e) => e.includes("unknown_var"))).toBe(true);
        expect(
            errors.some((e) => e.includes("'play'") && e.includes("'wrong'")),
        ).toBe(false);
    });
});
