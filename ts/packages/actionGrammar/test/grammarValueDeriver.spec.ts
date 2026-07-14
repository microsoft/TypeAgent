// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Direct unit tests for the pure `deriveEffectiveValue` helper in
// grammarValueDeriver.ts, used by grammarOptimizer.ts and nfaCompiler.ts.
// The consumers' own spec files (grammarOptimizerPromoteTail.spec.ts,
// nfaFactoredPrefixValues.spec.ts) already cover end-to-end wiring and
// promote decisions; nfaCompilerValueErrors.spec.ts covers
// `deriveEffectiveValue`'s throwing (requireValue: true) paths. These
// tests isolate its non-throwing (requireValue: false) derivation logic.

import { deriveEffectiveValue } from "../src/grammarValueDeriver.js";
import {
    createStringPart,
    createWildcardPart,
    createRulesPart,
    GrammarRule,
} from "../src/grammarTypes.js";

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
