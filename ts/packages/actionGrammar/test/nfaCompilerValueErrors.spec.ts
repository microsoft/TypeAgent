// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Direct, hand-built-AST coverage of `deriveEffectiveValue`'s
// (grammarValueDeriver.ts, called from nfaCompiler.ts) error paths when a
// top-level rule has no explicit `->` value and no single
// variable-bearing part to forward implicitly. These bypass the
// loader's own validation to exercise `compileGrammarToNFA`'s throw
// behavior directly, independent of any particular grammar-source
// scenario (e.g. shared-prefix factoring - see
// nfaFactoredPrefixValues.spec.ts for that).

import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import {
    Grammar,
    createStringPart,
    createPhraseSetPart,
} from "../src/grammarTypes.js";

describe("deriveEffectiveValue error messages", () => {
    it("throws a clear error when the implicit value is genuinely ambiguous", () => {
        // Raw AST (bypasses the loader's own validation) with two
        // variable-bearing parts and no top-level value.
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["foo"], "x"),
                        createStringPart(["bar"], "y"),
                    ],
                },
            ],
        };
        expect(() => compileGrammarToNFA(grammar, "ambiguous")).toThrow(
            /implicit value is ambiguous/,
        );
    });

    it("throws an accurate error (not 'Multi-term') for a single-part rule with no variable and no value", () => {
        // Raw AST with exactly one part, that part carrying no variable
        // and no top-level `value`. String-literal single-part rules are
        // auto-normalized (isSingleLiteralRule) to stamp a matched-text
        // value, so this uses an unbound phraseSet part instead - a
        // shape normalizeRule does not special-case. Guard here that the
        // message accurately reflects a 1-term rule instead of the
        // multi-term wording.
        const grammar: Grammar = {
            alternatives: [{ parts: [createPhraseSetPart("Polite")] }],
        };
        let message = "";
        try {
            compileGrammarToNFA(grammar, "single-part-none");
        } catch (e) {
            message = (e as Error).message;
        }
        expect(message).toMatch(/has 1 term but no value expression/);
        expect(message).not.toMatch(/Multi-term/);
    });

    it("throws an accurate error for a zero-part rule with no value", () => {
        const grammar: Grammar = {
            alternatives: [{ parts: [] }],
        };
        expect(() => compileGrammarToNFA(grammar, "empty-rule")).toThrow(
            /has 0 terms but no value expression/,
        );
    });
});
