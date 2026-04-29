// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * CI-oriented fuzz tests for the grammar system.
 *
 * Each `describe` block is a fixed-config call to the harness for one
 * fuzz dimension.  All validation logic lives in
 * `src/fuzz/fuzzHarness.ts`; this file just wires configs to Jest
 * `it()` assertions so they run in CI.
 *
 * For interactive / extended runs, use the CLI instead:
 *   node ./dist/fuzz/fuzzRunner.js --help
 */

import {
    runFuzz,
    mergeFeatures,
    type FuzzConfig,
    type FuzzResult,
    type FeaturesOverride,
    DEFAULT_CONFIG,
    MINIMAL_FEATURES,
} from "../src/fuzz/fuzzHarness.js";

/**
 * Run the harness and emit one `it()` per result so Jest reports
 * individual grammar/input failures.
 */
function fuzzDescribe(
    name: string,
    configOverrides: Omit<Partial<FuzzConfig>, "features" | "generator"> & {
        features?: FeaturesOverride;
        generator?: Partial<FuzzConfig["generator"]>;
    },
): void {
    describe(name, () => {
        // Merge config.  Per-dimension tests intentionally start from
        // MINIMAL_FEATURES (only literals + ruleRefs enabled) so they
        // isolate the dimension under test rather than inheriting the
        // broad-coverage defaults.
        const config: FuzzConfig = {
            ...DEFAULT_CONFIG,
            ...configOverrides,
            features: mergeFeatures(MINIMAL_FEATURES, configOverrides.features),
            generator: {
                ...DEFAULT_CONFIG.generator,
                ...(configOverrides.generator ?? {}),
            },
            validations:
                configOverrides.validations ?? DEFAULT_CONFIG.validations,
            verbose: false,
        };

        // Generate results eagerly (outside `it`) so grammar generation
        // cost is paid once rather than per-test.
        let results: FuzzResult[];
        try {
            results = runFuzz(config);
        } catch (e) {
            it("harness runs without crash", () => {
                throw e;
            });
            return;
        }

        if (results.length === 0) {
            it("generates at least one check", () => {
                throw new Error("No fuzz results produced");
            });
            return;
        }

        for (const r of results) {
            const inputTag = r.input !== undefined ? ` '${r.input}'` : "";
            it(`grammar #${r.grammarIndex} ${r.validation}${inputTag}`, () => {
                if (!r.passed) {
                    throw new Error(r.error ?? "unknown failure");
                }
            });
        }
    });
}

// ── Fuzz dimensions ───────────────────────────────────────────────────────────

// Original optimizer equivalence fuzz (formerly grammarOptimizerFuzz.spec.ts).
// Preserves the original seed + config for regression stability.
fuzzDescribe("Fuzz: optimizer equivalence (literals + ruleRefs)", {
    seed: 0xc0ffee,
    count: 40,
    inputsPerGrammar: 6,
    features: {
        partKinds: { literal: 1, ruleRef: 1 },
    },
    generator: {
        maxRules: 4,
        maxAlts: 4,
        maxParts: 4,
        words: ["a", "b", "c", "d", "e"],
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: optimizer equivalence (wildcards + values)", {
    seed: 0xf0221,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
        values: { attachProb: 0.7 },
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: parse-write round-trip", {
    seed: 0xf0222,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
        values: { attachProb: 0.7 },
    },
    validations: ["roundtrip-text"],
});

fuzzDescribe("Fuzz: spacing modes (optimizer equivalence)", {
    seed: 0xf0223,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1 },
        spacing: { altProb: 0.3, ruleProb: 0.4 },
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: JSON serialization round-trip", {
    seed: 0xf0224,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
    },
    validations: ["roundtrip-json"],
});

fuzzDescribe("Fuzz: optional / repeat groups (optimizer equivalence)", {
    seed: 0xf0225,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1 },
        groups: { optionalProb: 0.4, repeatProb: 0.3 },
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: optional / repeat groups (parse-write round-trip)", {
    seed: 0xf0226,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
        groups: { optionalProb: 0.3, repeatProb: 0.3 },
    },
    validations: ["roundtrip-text", "roundtrip-json"],
});

// ── Expanded value expression coverage (binary / unary / ternary /
// member access / spread / templates).  Exercises the writer's
// parenthesization logic and the optimizer-equivalence of expression
// evaluation across passes.
fuzzDescribe("Fuzz: rich value expressions (optimizer equivalence)", {
    seed: 0xf0227,
    count: 50,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
        values: { attachProb: 1.0 },
    },
    validations: ["optimizer", "roundtrip-text", "roundtrip-json"],
});

// ── Comments at flex-space slots.  Pure parser-only fluff: matching
// behavior is unchanged, so the optimizer-equivalence check verifies
// comments don't perturb match results, and the round-trip checks
// verify the writer preserves them idempotently.
fuzzDescribe("Fuzz: comment injection (line + block)", {
    seed: 0xf0228,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
        comments: { lineProb: 0.3, blockProb: 0.3 },
    },
    validations: ["optimizer", "roundtrip-text", "roundtrip-json"],
});

// ── Escape sequences inside literal tokens.  Literal text differs
// (identity / hex / unicode escapes) but the decoded character is
// unchanged, so matching behavior must remain identical.  Covers the
// parser's `<EscapeSequence>` paths and the writer's escape
// preservation.
fuzzDescribe("Fuzz: literal escape sequences", {
    seed: 0xf0229,
    count: 30,
    features: {
        partKinds: { literal: 2, ruleRef: 1 },
        vocabulary: { escapeProb: 0.5 },
    },
    validations: ["optimizer", "roundtrip-text", "roundtrip-json"],
});

// ── Nested rule captures `$(x:<Inner>)`.  The only fully
// unrepresented part-kind variant in `.agr` source.  Exercises the
// `RulesPart.variable` capture path on the parser, compiler, and
// matcher.
fuzzDescribe("Fuzz: nested rule captures", {
    seed: 0xf022a,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 0, wildcard: 0, nestedRuleRef: 2 },
        values: { attachProb: 0.5 },
    },
    validations: ["optimizer", "roundtrip-text", "roundtrip-json"],
});

// ── Separator characters embedded inside literal tokens.  A known
// bug-risk surface: punctuation and escaped-space chars are normally
// consumed by the matcher's flex-space regex, but inside a literal
// they must be matched as part of the token.  Hand-written tests
// live in `grammarMatcherKeywordSpacePunct.spec.ts`; this fuzzes the
// space.
fuzzDescribe("Fuzz: separator chars embedded in literals", {
    seed: 0xf022b,
    count: 50,
    features: {
        partKinds: { literal: 2, ruleRef: 1 },
        vocabulary: { separatorInLiteralProb: 0.5 },
        // Mix in spacing modes - the bug-risk interaction is
        // strongest when the rule is `none` or `optional` (where
        // input-side separators behave differently).
        spacing: { altProb: 0.3, ruleProb: 0.3 },
    },
    validations: ["optimizer", "roundtrip-text", "roundtrip-json"],
});

// ── Tail-call-friendly shapes for `promoteTailRulesParts`.  The pass
// looks for a trailing `RulesPart` (a `<RuleName>` reference at the
// end of a rule's parts) with effective member count >= 2 and either
// a forwarding parent (no value) or a parent value referencing the
// trailing capture.  Bias the generator toward ruleRef / nestedRuleRef
// parts and value attachment so promote-eligible forks appear in most
// generated grammars; the `promoteTailOnly` variant in the default
// optimizer-variant set then runs the pass in isolation.
fuzzDescribe("Fuzz: tail-call promote shapes (optimizer equivalence)", {
    seed: 0xf022c,
    count: 40,
    features: {
        partKinds: {
            literal: 1,
            ruleRef: 3,
            nestedRuleRef: 2,
            wildcard: 1,
            number: 1,
        },
        // High value-attach probability surfaces the substitution
        // branch of promote (parent value references the trailing
        // capture); the forwarding branch (no parent value) shows up
        // on the rules where not every alt attached a value.
        values: { attachProb: 0.7 },
    },
    // Add `roundtrip-text` so promotions through the
    // `EMPTY_FALLBACK_RULES` sentinel and synthesized opaque
    // wrapper bindings are also exercised through the serializer.
    validations: ["optimizer", "roundtrip-text"],
});
