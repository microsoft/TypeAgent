// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for spacing mode support in NFA compilation and matching.
 *
 * Three modes under test:
 *   spacing=none     — segments are concatenated at compile time into a single
 *                      fused token; input must have no whitespace between them.
 *   spacing=optional — segments are kept as separate NFA token transitions, but
 *                      non-word-starting tokens (e.g. "'s", "'t") are registered
 *                      as split candidates so that fused input like "Swift's"
 *                      is pre-split before the NFA runs.
 *   spacing=auto     — same split-candidate logic as optional, but also applies
 *                      to CJK scripts where ANY grammar token is a candidate
 *                      (e.g. "黃色汽車" → ["黃色", "汽車"]).
 *   spacing=required — default: whitespace-tokenised input is matched as-is;
 *                      no over-splitting of contractions in required rules.
 */

import { Grammar } from "../src/grammarTypes.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchGrammarWithNFA } from "../src/nfaMatcher.js";

// ---------------------------------------------------------------------------
// Helper: compile and match in one call
// ---------------------------------------------------------------------------
function match(grammar: Grammar, request: string) {
    const nfa = compileGrammarToNFA(grammar);
    return matchGrammarWithNFA(grammar, nfa, request);
}

// ---------------------------------------------------------------------------
// spacing=none
// ---------------------------------------------------------------------------
describe("spacing=none", () => {
    // Grammar: <R> [spacing=none] = hip hop -> "hiphop";
    const grammar: Grammar = {
        rules: [
            {
                parts: [{ type: "string", value: ["hip", "hop"] }],
                spacingMode: "none",
                value: { type: "literal", value: "hiphop" },
            },
        ],
    };

    it("matches the fused (no-space) form", () => {
        const results = match(grammar, "hiphop");
        expect(results).toHaveLength(1);
        // 1 fixed token matched, no wildcards consumed
        expect(results[0].matchedValueCount).toBe(1);
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("does NOT match the space-separated form", () => {
        // spacing=none compiles to a single fused token; two separate tokens
        // will never reach the NFA accept state.
        const results = match(grammar, "hip hop");
        expect(results).toHaveLength(0);
    });

    it("does NOT match a partial form", () => {
        expect(match(grammar, "hip")).toHaveLength(0);
        expect(match(grammar, "hop")).toHaveLength(0);
    });

    it("produces a single token transition in the NFA", () => {
        const nfa = compileGrammarToNFA(grammar);
        // Find the fused token transition
        const fusedTransitions = nfa.states.flatMap((s) =>
            s.transitions.filter(
                (t) => t.type === "token" && t.tokens?.includes("hiphop"),
            ),
        );
        expect(fusedTransitions).toHaveLength(1);
    });

    it("stores NO split candidates (none mode never needs runtime split)", () => {
        const nfa = compileGrammarToNFA(grammar);
        const statesWithCandidates = nfa.states.filter(
            (s) => s.splitCandidates && s.splitCandidates.length > 0,
        );
        expect(statesWithCandidates).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// spacing=none — case-insensitive normalisation still applies
// ---------------------------------------------------------------------------
describe("spacing=none normalisation", () => {
    const grammar: Grammar = {
        rules: [
            {
                parts: [{ type: "string", value: ["Hip", "Hop"] }],
                spacingMode: "none",
                value: { type: "literal", value: "matched" },
            },
        ],
    };

    it("matches case-insensitively after normalisation", () => {
        // normalizeToken lowercases before fusion, so "Hip" + "Hop" → "hiphop"
        // and the input "hiphop" is also lowercased before comparison
        expect(match(grammar, "hiphop")).toHaveLength(1);
        expect(match(grammar, "HipHop")).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// spacing=optional — English morpheme splitting ("'s")
// ---------------------------------------------------------------------------
describe("spacing=optional — apostrophe morpheme splitting", () => {
    // Grammar: <R> [spacing=optional] = $(artist:wildcard) 's -> artist;
    // (apostrophe-s is the possessive suffix)
    const grammar: Grammar = {
        rules: [
            {
                parts: [
                    {
                        type: "wildcard",
                        variable: "artist",
                        typeName: "wildcard",
                    },
                    { type: "string", value: ["'s"] },
                ],
                spacingMode: "optional",
                value: { type: "variable", name: "artist" },
            },
        ],
    };

    it("matches when 's is a separate token (space before it)", () => {
        // "Taylor Swift 's" → tokens ["Taylor", "Swift", "'s"] (natural split)
        const results = match(grammar, "Taylor Swift 's");
        expect(results).toHaveLength(1);
    });

    it("matches when 's is fused to the preceding word (no space)", () => {
        // "Taylor Swift's" → whitespace tokens ["Taylor", "Swift's"]
        // Pre-split: "Swift's" → ["Swift", "'s"] ✓
        const results = match(grammar, "Taylor Swift's");
        expect(results).toHaveLength(1);
    });

    it("does NOT match when 's is absent", () => {
        expect(match(grammar, "Taylor Swift")).toHaveLength(0);
    });

    it('stores "\'s" as a split candidate on the rule entry state', () => {
        const nfa = compileGrammarToNFA(grammar);
        const entryState = nfa.states.find((s) => s.splitCandidates);
        expect(entryState).toBeDefined();
        expect(entryState!.splitCandidates).toContain("'s");
    });
});

// ---------------------------------------------------------------------------
// spacing=optional — contraction "'t" splitting
// ---------------------------------------------------------------------------
describe("spacing=optional — contraction splitting", () => {
    // Grammar: <R> [spacing=optional] = $(v:wildcard) 't -> v;
    // (captures the verb stem before "'t", e.g. "don't" → v="don")
    const grammar: Grammar = {
        rules: [
            {
                parts: [
                    { type: "wildcard", variable: "v", typeName: "wildcard" },
                    { type: "string", value: ["'t"] },
                ],
                spacingMode: "optional",
                value: { type: "variable", name: "v" },
            },
        ],
    };

    it("matches fused contraction", () => {
        // "don't" → ["don", "'t"] after pre-split
        const results = match(grammar, "don't");
        expect(results).toHaveLength(1);
    });

    it('stores "\'t" as a split candidate', () => {
        const nfa = compileGrammarToNFA(grammar);
        const entryState = nfa.states.find((s) => s.splitCandidates);
        expect(entryState!.splitCandidates).toContain("'t");
    });
});

// ---------------------------------------------------------------------------
// spacing=required — no over-splitting; contraction stays fused
// ---------------------------------------------------------------------------
describe("spacing=required — regression: contractions not over-split", () => {
    // A required rule that has "don't" as a fixed token should still match
    // the fused input "don't" even when other optional rules in the same NFA
    // register "'t" as a split candidate.
    const grammar: Grammar = {
        rules: [
            // required rule — expects "don't" as one token
            {
                parts: [{ type: "string", value: ["don't"] }],
                spacingMode: "required",
                value: { type: "literal", value: "matched-required" },
            },
            // optional rule — registers "'t" as a split candidate
            {
                parts: [
                    { type: "wildcard", variable: "v", typeName: "wildcard" },
                    { type: "string", value: ["'t"] },
                ],
                spacingMode: "optional",
                value: { type: "variable", name: "v" },
            },
        ],
    };

    it("still matches the required rule with fused contraction input", () => {
        // Pass 1 (original tokens): ["don't"] → required rule matches ✓
        // Pass 2 (split tokens): ["don", "'t"] → optional rule also matches
        // Priority: required rule has 1 fixed token + 0 unchecked wildcards;
        //           optional rule has 1 fixed + 1 unchecked wildcard → required wins
        const results = match(grammar, "don't");
        expect(results).toHaveLength(1);
        // wildcardCharCount === 0 proves the required (all-fixed) rule won, not the optional one
        expect(results[0].wildcardCharCount).toBe(0);
        expect(results[0].matchedValueCount).toBe(1);
    });

    it("stores no split candidates for the required rule entry state", () => {
        const nfa = compileGrammarToNFA(grammar);
        // Count states with split candidates — only the optional rule's entry
        // should have them, not the required rule's entry
        const candidateStates = nfa.states.filter(
            (s) => s.splitCandidates && s.splitCandidates.length > 0,
        );
        // The NFA has exactly one rule with split candidates (the optional one)
        expect(candidateStates).toHaveLength(1);
        expect(candidateStates[0].splitCandidates).toContain("'t");
    });
});

// ---------------------------------------------------------------------------
// spacing=auto — CJK: no spaces between colour and car
// ---------------------------------------------------------------------------
describe("spacing=auto (undefined) — CJK token pre-splitting", () => {
    // Grammar:
    //   <color> [spacing=auto] = 黃色 | 藍色 | 綠色;      (yellow/blue/green)
    //   <showCar> [spacing=auto] = $(color:<color>) 汽車;  (color + car)
    //
    // Built inline as a Grammar object using nested RulesPart alternatives.

    // The <color> alternatives as inline rules
    const yellowRule = {
        parts: [{ type: "string" as const, value: ["黃色"] }],
        value: { type: "literal" as const, value: "yellow" },
        spacingMode: undefined as undefined, // auto
    };
    const blueRule = {
        parts: [{ type: "string" as const, value: ["藍色"] }],
        value: { type: "literal" as const, value: "blue" },
        spacingMode: undefined as undefined,
    };
    const greenRule = {
        parts: [{ type: "string" as const, value: ["綠色"] }],
        value: { type: "literal" as const, value: "green" },
        spacingMode: undefined as undefined,
    };

    const grammar: Grammar = {
        rules: [
            {
                parts: [
                    {
                        type: "rules",
                        rules: [yellowRule, blueRule, greenRule],
                        variable: "color",
                    },
                    { type: "string", value: ["汽車"] },
                ],
                spacingMode: undefined, // auto
                value: { type: "variable", name: "color" },
            },
        ],
    };

    it("matches when colour and car are space-separated (normal tokenisation)", () => {
        expect(match(grammar, "黃色 汽車")).toHaveLength(1);
        expect(match(grammar, "藍色 汽車")).toHaveLength(1);
        expect(match(grammar, "綠色 汽車")).toHaveLength(1);
    });

    it("matches when colour and car are fused (no space — CJK style)", () => {
        // "黃色汽車" → whitespace tokeniser → ["黃色汽車"] (one token)
        // split candidates include "黃色", "藍色", "綠色", "汽車" (all CJK → no word boundary)
        // pre-split: "黃色汽車" → ["黃色", "汽車"] ✓
        expect(match(grammar, "黃色汽車")).toHaveLength(1);
        expect(match(grammar, "藍色汽車")).toHaveLength(1);
        expect(match(grammar, "綠色汽車")).toHaveLength(1);
    });

    it("does NOT match an unrecognised colour", () => {
        // "紅色" = red — not in grammar
        expect(match(grammar, "紅色汽車")).toHaveLength(0);
        expect(match(grammar, "紅色 汽車")).toHaveLength(0);
    });

    it("does NOT match colour alone (missing car)", () => {
        expect(match(grammar, "黃色")).toHaveLength(0);
    });

    it("stores CJK tokens as split candidates", () => {
        const nfa = compileGrammarToNFA(grammar);
        const allCandidates = nfa.states.flatMap(
            (s) => s.splitCandidates ?? [],
        );
        // CJK tokens are non-word-starting → all become candidates
        expect(allCandidates).toContain("黃色");
        expect(allCandidates).toContain("藍色");
        expect(allCandidates).toContain("綠色");
        expect(allCandidates).toContain("汽車");
    });
});

// ---------------------------------------------------------------------------
// spacing=auto — mixed: Latin optional suffix alongside CJK (no cross-talk)
// ---------------------------------------------------------------------------
describe("spacing=auto — Latin token NOT registered as split candidate", () => {
    // A rule with "play" (Latin) and "'s" (non-word-starting) in auto mode.
    // Only "'s" should be a split candidate; "play" starts with a Latin letter.
    const grammar: Grammar = {
        rules: [
            {
                parts: [
                    { type: "string", value: ["play"] },
                    { type: "string", value: ["'s"] },
                ],
                spacingMode: undefined, // auto
                value: { type: "literal", value: "matched" },
            },
        ],
    };

    it("registers only the non-word-starting token as a split candidate", () => {
        const nfa = compileGrammarToNFA(grammar);
        const allCandidates = nfa.states.flatMap(
            (s) => s.splitCandidates ?? [],
        );
        expect(allCandidates).toContain("'s");
        expect(allCandidates).not.toContain("play");
    });
});

// ---------------------------------------------------------------------------
// spacing=none — multi-segment with three words
// ---------------------------------------------------------------------------
describe("spacing=none — three-segment fusion", () => {
    const grammar: Grammar = {
        rules: [
            {
                parts: [{ type: "string", value: ["rock", "and", "roll"] }],
                spacingMode: "none",
                value: { type: "literal", value: "genre" },
            },
        ],
    };

    it("matches the fully fused token", () => {
        expect(match(grammar, "rockandroll")).toHaveLength(1);
    });

    it("does NOT match partial fusions", () => {
        expect(match(grammar, "rockand roll")).toHaveLength(0);
        expect(match(grammar, "rock androll")).toHaveLength(0);
        expect(match(grammar, "rock and roll")).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// spacing=none — German compound nouns (Komposita)
// ---------------------------------------------------------------------------
// German consistently fuses compound nouns into single orthographic words.
// spacing=none is the natural fit: grammar authors write morphemes separately
// (readable), and the compiler fuses them into a single token at build time.
//
// Contrast with CJK (spacing=auto): CJK uses runtime pre-splitting because
// grammar tokens are non-word-boundary-starting (no Latin script).
// German morphemes start with Latin letters — requiresWordBoundaryBefore()
// returns true — so they are NOT runtime split candidates.  spacing=none
// handles German compounds entirely at compile time.
// ---------------------------------------------------------------------------

describe("spacing=none — German two-morpheme compound (Fahrrad = bicycle)", () => {
    // <bicycle> [spacing=none] = Fahr rad -> "bicycle";
    // Fahr (travel/ride) + Rad (wheel) → Fahrrad
    const grammar: Grammar = {
        rules: [
            {
                parts: [{ type: "string", value: ["Fahr", "rad"] }],
                spacingMode: "none",
                value: { type: "literal", value: "bicycle" },
            },
        ],
    };

    it("matches the fused German compound", () => {
        const results = match(grammar, "Fahrrad");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(1);
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("is case-insensitive (Fahrrad = fahrrad = FAHRRAD)", () => {
        expect(match(grammar, "fahrrad")).toHaveLength(1);
        expect(match(grammar, "FAHRRAD")).toHaveLength(1);
    });

    it("does NOT match the space-separated form", () => {
        expect(match(grammar, "Fahr rad")).toHaveLength(0);
    });
});

describe("spacing=none — German three-morpheme compound (Kraftfahrzeug = motor vehicle)", () => {
    // Kraft (power/force) + Fahr (travel/drive) + Zeug (tool/device) → Kraftfahrzeug
    const grammar: Grammar = {
        rules: [
            {
                parts: [{ type: "string", value: ["Kraft", "Fahr", "Zeug"] }],
                spacingMode: "none",
                value: { type: "literal", value: "motor vehicle" },
            },
        ],
    };

    it("matches the fused three-morpheme compound", () => {
        const results = match(grammar, "Kraftfahrzeug");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(1);
    });

    it("produces exactly one fused NFA token for all three morphemes", () => {
        const nfa = compileGrammarToNFA(grammar);
        const fusedTransitions = nfa.states.flatMap((s) =>
            s.transitions.filter(
                (t) =>
                    t.type === "token" && t.tokens?.includes("kraftfahrzeug"),
            ),
        );
        expect(fusedTransitions).toHaveLength(1);
    });

    it("does NOT match any partial fusion", () => {
        expect(match(grammar, "Kraft Fahrzeug")).toHaveLength(0);
        expect(match(grammar, "Kraftfahr Zeug")).toHaveLength(0);
        expect(match(grammar, "Kraft Fahr Zeug")).toHaveLength(0);
    });
});

describe("spacing=none — German four-morpheme compound (Donaudampfschifffahrt)", () => {
    // Donau (Danube) + Dampf (steam) + Schiff (ship) + Fahrt (voyage/journey)
    // → Donaudampfschifffahrt  (triple-f is correct post-1996-reform spelling:
    //   Schiff ends in ff, Fahrt begins with f → Schiff·fahrt = Schifffahrt)
    // A fragment of the celebrated Donaudampfschiffahrtsgesellschaft
    // (Danube Steamship Company) — a touchstone of German morphology.
    const grammar: Grammar = {
        rules: [
            {
                parts: [
                    {
                        type: "string",
                        value: ["Donau", "Dampf", "Schiff", "Fahrt"],
                    },
                ],
                spacingMode: "none",
                value: { type: "literal", value: "danube-steamship-voyage" },
            },
        ],
    };

    it("matches the fully fused four-morpheme compound", () => {
        const results = match(grammar, "Donaudampfschifffahrt");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(1);
    });

    it("produces a single fused NFA token for all four morphemes", () => {
        const nfa = compileGrammarToNFA(grammar);
        const fusedTransitions = nfa.states.flatMap((s) =>
            s.transitions.filter(
                (t) =>
                    t.type === "token" &&
                    t.tokens?.includes("donaudampfschifffahrt"),
            ),
        );
        expect(fusedTransitions).toHaveLength(1);
    });

    it("does NOT match any partial fusion or fully spaced form", () => {
        expect(match(grammar, "Donau Dampfschifffahrt")).toHaveLength(0);
        expect(match(grammar, "Donaudampf Schifffahrt")).toHaveLength(0);
        expect(match(grammar, "Donau Dampf Schiff Fahrt")).toHaveLength(0);
    });

    it("stores no split candidates (compile-time fusion, no runtime splitting needed)", () => {
        const nfa = compileGrammarToNFA(grammar);
        const candidateStates = nfa.states.filter(
            (s) => s.splitCandidates && s.splitCandidates.length > 0,
        );
        expect(candidateStates).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// spacing=auto — German words NOT split candidates (unlike CJK)
// ---------------------------------------------------------------------------
// German morphemes begin with Latin letters.  requiresWordBoundaryBefore()
// returns true for all Latin-script first characters, so none of them are
// registered as runtime split candidates even in auto mode.
// → German compounds need spacing=none (compile-time), not spacing=auto (runtime).
// ---------------------------------------------------------------------------
describe("spacing=auto — German Latin tokens NOT registered as split candidates", () => {
    // Two string parts in auto mode — neither starts with a non-word-boundary char.
    const grammar: Grammar = {
        rules: [
            {
                parts: [
                    { type: "string", value: ["Fahr"] },
                    { type: "string", value: ["rad"] },
                ],
                spacingMode: undefined, // auto
                value: { type: "literal", value: "bicycle" },
            },
        ],
    };

    it("stores no split candidates (Latin tokens are word-boundary-starting)", () => {
        const nfa = compileGrammarToNFA(grammar);
        const allCandidates = nfa.states.flatMap(
            (s) => s.splitCandidates ?? [],
        );
        expect(allCandidates).not.toContain("fahr");
        expect(allCandidates).not.toContain("rad");
        expect(allCandidates).toHaveLength(0);
    });

    it("matches the space-separated form (auto behaves like required for Latin tokens)", () => {
        expect(match(grammar, "Fahr rad")).toHaveLength(1);
    });

    it("does NOT match the fused form (use spacing=none for German compounds)", () => {
        // Without split candidates, "Fahrrad" is never pre-split → no match
        expect(match(grammar, "Fahrrad")).toHaveLength(0);
    });
});
