// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Direct unit tests for the pure helpers in grammarValueDeriver.ts,
// shared by grammarOptimizer.ts (`getImplicitDefaultValue`,
// `checkForwardingPromotable`) and nfaCompiler.ts (`deriveEffectiveValue`).
// The consumers' own spec files (grammarOptimizerPromoteTail.spec.ts,
// nfaFactoredPrefixValues.spec.ts) already cover end-to-end wiring and
// throw/promote decisions; these tests isolate the pure derivation logic
// itself.

import {
    findSingleValueBearingPart,
    deriveValue,
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

    it("returns the variable of the single variable-bearing part", () => {
        const parts = [
            createStringPart(["foo"]),
            createWildcardPart("x", "wildcard"),
        ];
        expect(findSingleValueBearingPart(parts)).toEqual({ variable: "x" });
    });

    it("finds the variable-bearing part regardless of position", () => {
        const parts = [
            createWildcardPart("x", "wildcard"),
            createStringPart(["foo"]),
        ];
        expect(findSingleValueBearingPart(parts)).toEqual({ variable: "x" });
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

describe("deriveValue", () => {
    it("returns the rule's explicit value when present, ignoring parts", () => {
        const rule: GrammarRule = {
            parts: [
                createStringPart(["foo"], "x"),
                createStringPart(["bar"], "y"),
            ],
            value: { type: "literal", value: "explicit" },
        };
        expect(deriveValue(rule)).toEqual({
            kind: "value",
            value: { type: "literal", value: "explicit" },
        });
    });

    it('returns "none" for a rule with no parts and no value', () => {
        const rule: GrammarRule = { parts: [] };
        expect(deriveValue(rule)).toEqual({ kind: "none" });
    });

    it('returns "none" for a single part with no variable', () => {
        const rule: GrammarRule = { parts: [createStringPart(["foo"])] };
        expect(deriveValue(rule)).toEqual({ kind: "none" });
    });

    it("forwards a single part's variable as the implicit value", () => {
        const rule: GrammarRule = {
            parts: [
                createStringPart(["foo"]),
                createWildcardPart("x", "wildcard"),
            ],
        };
        expect(deriveValue(rule)).toEqual({
            kind: "value",
            value: { type: "variable", name: "x" },
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
        expect(deriveValue(rule)).toEqual({
            kind: "value",
            value: { type: "variable", name: "chosen" },
        });
    });

    it('returns "ambiguous" when 2+ parts carry a variable and there is no explicit value', () => {
        const rule: GrammarRule = {
            parts: [
                createStringPart(["foo"], "x"),
                createStringPart(["bar"], "y"),
            ],
        };
        expect(deriveValue(rule)).toEqual({ kind: "ambiguous" });
    });

    it('returns "none" for a multi-part rule where nothing carries a variable', () => {
        const rule: GrammarRule = {
            parts: [createStringPart(["foo"]), createStringPart(["bar"])],
        };
        expect(deriveValue(rule)).toEqual({ kind: "none" });
    });
});
