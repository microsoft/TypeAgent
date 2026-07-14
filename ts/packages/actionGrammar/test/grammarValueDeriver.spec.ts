// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Direct unit tests for the pure helpers in grammarValueDeriver.ts, shared
// by grammarOptimizer.ts (`checkForwardingPromotable`) and nfaCompiler.ts
// (via `deriveEffectiveValue`, which lives in this module).
// The consumers' own spec files (grammarOptimizerPromoteTail.spec.ts,
// nfaFactoredPrefixValues.spec.ts) already cover end-to-end wiring and
// promote decisions; nfaCompilerValueErrors.spec.ts covers
// `deriveEffectiveValue`'s throwing (requireValue: true) paths. These
// tests isolate its non-throwing (requireValue: false) derivation logic.

import {
    findSingleValueBearingPart,
    deriveEffectiveValue,
} from "../src/grammarValueDeriver.js";
import {
    createStringPart,
    createWildcardPart,
    createRulesPart,
    GrammarRule,
} from "../src/grammarTypes.js";

describe("findSingleValueBearingPart", () => {
    it("returns undefined for an empty parts array", () => {
        expect(findSingleValueBearingPart([])).toBeUndefined();
    });

    it("returns undefined when no part carries a variable", () => {
        const parts = [createStringPart(["foo"]), createStringPart(["bar"])];
        expect(findSingleValueBearingPart(parts)).toBeUndefined();
    });

    it("returns the variable and part of the single variable-bearing part", () => {
        const wildcardPart = createWildcardPart("x", "wildcard");
        const parts = [createStringPart(["foo"]), wildcardPart];
        expect(findSingleValueBearingPart(parts)).toEqual({
            variable: "x",
            part: wildcardPart,
        });
    });

    it("finds the variable-bearing part regardless of position", () => {
        const wildcardPart = createWildcardPart("x", "wildcard");
        const parts = [wildcardPart, createStringPart(["foo"])];
        expect(findSingleValueBearingPart(parts)).toEqual({
            variable: "x",
            part: wildcardPart,
        });
    });

    it('returns "ambiguous" when 2+ parts carry a variable', () => {
        const parts = [
            createStringPart(["foo"], "x"),
            createStringPart(["bar"], "y"),
        ];
        expect(findSingleValueBearingPart(parts)).toBe("ambiguous");
    });

    it('returns "ambiguous" even when 3+ parts carry a variable', () => {
        const parts = [
            createStringPart(["foo"], "x"),
            createStringPart(["bar"], "y"),
            createStringPart(["baz"], "z"),
        ];
        expect(findSingleValueBearingPart(parts)).toBe("ambiguous");
    });
});

describe("deriveEffectiveValue (requireValue: false)", () => {
    it("returns the rule's explicit value when present, ignoring parts", () => {
        const rule: GrammarRule = {
            parts: [
                createStringPart(["foo"], "x"),
                createStringPart(["bar"], "y"),
            ],
            value: { type: "literal", value: "explicit" },
        };
        expect(deriveEffectiveValue(rule)).toEqual({
            type: "literal",
            value: "explicit",
        });
    });

    it("returns undefined for a rule with no parts and no value", () => {
        const rule: GrammarRule = { parts: [] };
        expect(deriveEffectiveValue(rule)).toBeUndefined();
    });

    it("returns undefined for a single part with no variable", () => {
        const rule: GrammarRule = { parts: [createStringPart(["foo"])] };
        expect(deriveEffectiveValue(rule)).toBeUndefined();
    });

    it("forwards a single part's variable as the implicit value", () => {
        const rule: GrammarRule = {
            parts: [
                createStringPart(["foo"]),
                createWildcardPart("x", "wildcard"),
            ],
        };
        expect(deriveEffectiveValue(rule)).toEqual({
            type: "variable",
            name: "x",
        });
    });

    it("forwards a nested RulesPart's captured variable", () => {
        const nested = createRulesPart(
            [{ parts: [createStringPart(["foo"])] }],
            {
                variable: "chosen",
            },
        );
        const rule: GrammarRule = {
            parts: [createStringPart(["prefix"]), nested],
        };
        expect(deriveEffectiveValue(rule)).toEqual({
            type: "variable",
            name: "chosen",
        });
    });

    it("returns undefined when 2+ parts carry a variable and there is no explicit value", () => {
        const rule: GrammarRule = {
            parts: [
                createStringPart(["foo"], "x"),
                createStringPart(["bar"], "y"),
            ],
        };
        expect(deriveEffectiveValue(rule)).toBeUndefined();
    });

    it("returns undefined for a multi-part rule where nothing carries a variable", () => {
        const rule: GrammarRule = {
            parts: [createStringPart(["foo"]), createStringPart(["bar"])],
        };
        expect(deriveEffectiveValue(rule)).toBeUndefined();
    });
});
