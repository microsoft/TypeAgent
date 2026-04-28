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
// flex-space — two-segment compound (hip hop / hiphop)
// ---------------------------------------------------------------------------
describe("flex-space — two-segment compound (hip hop)", () => {
    // Grammar: <R> = hip hop -> "hiphop";
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["hip"] },
                    { type: "string", value: ["hop"] },
                ],
                value: { type: "literal", value: "hiphop" },
            },
        ],
    };

    it("matches the fused form (hiphop) via prefix splitting", () => {
        const results = match(grammar, "hiphop");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(2); // 2 fixed tokens: hip + hop
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches the space-separated form (hip hop)", () => {
        const results = match(grammar, "hip hop");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(2);
    });

    it("does NOT match a partial form", () => {
        expect(match(grammar, "hip")).toHaveLength(0);
        expect(match(grammar, "hop")).toHaveLength(0);
    });

    it("NFA has separate token transitions (not fused)", () => {
        const nfa = compileGrammarToNFA(grammar);
        const hasToken = (tok: string) =>
            nfa.states.some((s) =>
                s.transitions.some(
                    (t) => t.type === "token" && t.tokens?.includes(tok),
                ),
            );
        expect(hasToken("hip")).toBe(true);
        expect(hasToken("hop")).toBe(true);
        expect(hasToken("hiphop")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// flex-space — case-insensitive normalisation
// ---------------------------------------------------------------------------
describe("flex-space — case-insensitive normalisation", () => {
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["Hip"] },
                    { type: "string", value: ["Hop"] },
                ],
                value: { type: "literal", value: "matched" },
            },
        ],
    };

    it("matches case-insensitively (hiphop, HipHop, hip hop)", () => {
        expect(match(grammar, "hiphop")).toHaveLength(1);
        expect(match(grammar, "HipHop")).toHaveLength(1);
        expect(match(grammar, "hip hop")).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Auto split candidates — English possessive "'s"
// ---------------------------------------------------------------------------
// In auto mode, "'s" starts with an apostrophe (non-word-boundary) so it is
// automatically registered as a split candidate.  Pre-splitting "Swift's" →
// ["Swift", "'s"] lets the wildcard consume "Swift" and "'s" match separately.
// ---------------------------------------------------------------------------
describe("auto split candidates — apostrophe morpheme splitting", () => {
    // Grammar: <R> = $(artist:wildcard) 's -> artist;
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    {
                        type: "wildcard",
                        variable: "artist",
                        typeName: "wildcard",
                    },
                    { type: "string", value: ["'s"] },
                ],
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

    it('stores "\'s" as a split candidate (apostrophe is non-word-boundary)', () => {
        const nfa = compileGrammarToNFA(grammar);
        const entryState = nfa.states.find((s) => s.splitCandidates);
        expect(entryState).toBeDefined();
        expect(entryState!.splitCandidates).toContain("'s");
    });
});

// ---------------------------------------------------------------------------
// Auto split candidates — contraction "'t" splitting
// ---------------------------------------------------------------------------
describe("auto split candidates — contraction splitting", () => {
    // Grammar: <R> = $(v:wildcard) 't -> v;
    // (captures the verb stem before "'t", e.g. "don't" → v="don")
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "wildcard", variable: "v", typeName: "wildcard" },
                    { type: "string", value: ["'t"] },
                ],
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
// Two-pass matching — literal contraction beats wildcard + suffix
// ---------------------------------------------------------------------------
// When both rules use auto mode, both contribute split candidates.  "'t"
// (non-word-boundary) is registered as a split candidate from rule 2.
// "don't" (starts with "d", word-boundary) is NOT a split candidate.
//
// Two-pass matching ensures both interpretations are tried:
//   Pass 1 (original tokens): ["don't"] → literal rule matches ✓
//   Pass 2 (split tokens):    ["don", "'t"] → wildcard rule matches ✓
// Priority: literal rule has 1 fixed + 0 wildcards → wins.
// ---------------------------------------------------------------------------
describe("two-pass matching — literal contraction wins over wildcard + suffix", () => {
    const grammar: Grammar = {
        alternatives: [
            // Literal rule — expects "don't" as one token
            {
                parts: [{ type: "string", value: ["don't"] }],
                value: { type: "literal", value: "matched-literal" },
            },
            // Wildcard + suffix rule — "'t" registered as split candidate
            {
                parts: [
                    { type: "wildcard", variable: "v", typeName: "wildcard" },
                    { type: "string", value: ["'t"] },
                ],
                value: { type: "variable", name: "v" },
            },
        ],
    };

    it("the literal rule wins by priority (all-fixed beats wildcard)", () => {
        const results = match(grammar, "don't");
        expect(results).toHaveLength(1);
        // wildcardCharCount === 0 proves the literal (all-fixed) rule won
        expect(results[0].wildcardCharCount).toBe(0);
        expect(results[0].matchedValueCount).toBe(1);
    });

    it("both rules register split candidates via auto", () => {
        const nfa = compileGrammarToNFA(grammar);
        const candidateStates = nfa.states.filter(
            (s) => s.splitCandidates && s.splitCandidates.length > 0,
        );
        // Both rules collect split candidates in auto mode, but only "'t"
        // qualifies (non-word-boundary). "don't" starts with "d" → excluded.
        // Both rules share "'t" as a candidate on their entry states.
        expect(candidateStates.length).toBeGreaterThanOrEqual(1);
        const allCandidates = candidateStates.flatMap(
            (s) => s.splitCandidates!,
        );
        expect(allCandidates).toContain("'t");
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
        alternatives: [
            {
                parts: [
                    {
                        type: "rules",
                        alternatives: [yellowRule, blueRule, greenRule],
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
        alternatives: [
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
describe("flex-space — three-segment English compound (rock and roll)", () => {
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["rock"] },
                    { type: "string", value: ["and"] },
                    { type: "string", value: ["roll"] },
                ],
                value: { type: "literal", value: "genre" },
            },
        ],
    };

    it("matches the fully fused form (rockandroll) via prefix splitting", () => {
        const results = match(grammar, "rockandroll");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 fixed tokens
    });

    it("matches all partial fusions and fully spaced form", () => {
        expect(match(grammar, "rockand roll")).toHaveLength(1);
        expect(match(grammar, "rock androll")).toHaveLength(1);
        expect(match(grammar, "rock and roll")).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// flex-space — German compound nouns (Komposita)
// ---------------------------------------------------------------------------
// German fuses compound nouns into single orthographic words.  With separate
// StringParts and default spacing (auto), the NFA has individual token
// transitions for each morpheme.  On-demand prefix splitting in the NFA queue
// handles fused input: "Fahr" is a prefix of "Fahrrad" → fork with
// ["Fahr","rad"] → both the spaced and fused forms match.
// ---------------------------------------------------------------------------

describe("flex-space — German two-morpheme compound (Fahrrad = bicycle)", () => {
    // Fahr (travel/ride) + Rad (wheel) → Fahrrad
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["Fahr"] },
                    { type: "string", value: ["rad"] },
                ],
                value: { type: "literal", value: "bicycle" },
            },
        ],
    };

    it("matches the fused German compound (Fahrrad) via prefix splitting", () => {
        const results = match(grammar, "Fahrrad");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(2); // 2 fixed tokens: Fahr + rad
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches the space-separated form (Fahr rad)", () => {
        expect(match(grammar, "Fahr rad")).toHaveLength(1);
    });

    it("is case-insensitive (Fahrrad = fahrrad = FAHRRAD)", () => {
        expect(match(grammar, "fahrrad")).toHaveLength(1);
        expect(match(grammar, "FAHRRAD")).toHaveLength(1);
    });
});

describe("flex-space — German three-morpheme compound (Kraftfahrzeug = motor vehicle)", () => {
    // Kraft (power/force) + Fahr (travel/drive) + Zeug (tool/device) → Kraftfahrzeug
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["Kraft"] },
                    { type: "string", value: ["Fahr"] },
                    { type: "string", value: ["Zeug"] },
                ],
                value: { type: "literal", value: "motor vehicle" },
            },
        ],
    };

    it("matches the fused three-morpheme compound via prefix splitting", () => {
        const results = match(grammar, "Kraftfahrzeug");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 fixed tokens
    });

    it("NFA has separate token transitions (not fused)", () => {
        const nfa = compileGrammarToNFA(grammar);
        const hasToken = (tok: string) =>
            nfa.states.some((s) =>
                s.transitions.some(
                    (t) => t.type === "token" && t.tokens?.includes(tok),
                ),
            );
        expect(hasToken("kraft")).toBe(true);
        expect(hasToken("fahr")).toBe(true);
        expect(hasToken("zeug")).toBe(true);
        expect(hasToken("kraftfahrzeug")).toBe(false);
    });

    it("matches all partial fusions and fully spaced form", () => {
        expect(match(grammar, "Kraft Fahrzeug")).toHaveLength(1);
        expect(match(grammar, "Kraftfahr Zeug")).toHaveLength(1);
        expect(match(grammar, "Kraft Fahr Zeug")).toHaveLength(1);
    });
});

describe("flex-space — German four-morpheme compound (Donaudampfschifffahrt)", () => {
    // Donau (Danube) + Dampf (steam) + Schiff (ship) + Fahrt (voyage/journey)
    // → Donaudampfschifffahrt  (triple-f is correct post-1996-reform spelling:
    //   Schiff ends in ff, Fahrt begins with f → Schiff·fahrt = Schifffahrt)
    // A fragment of the celebrated Donaudampfschiffahrtsgesellschaft
    // (Danube Steamship Company) — a touchstone of German morphology.
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["Donau"] },
                    { type: "string", value: ["Dampf"] },
                    { type: "string", value: ["Schiff"] },
                    { type: "string", value: ["Fahrt"] },
                ],
                value: { type: "literal", value: "danube-steamship-voyage" },
            },
        ],
    };

    it("matches the fully fused four-morpheme compound via prefix splitting", () => {
        const results = match(grammar, "Donaudampfschifffahrt");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(4); // 4 fixed tokens
    });

    it("NFA has separate token transitions (not fused)", () => {
        const nfa = compileGrammarToNFA(grammar);
        const hasToken = (tok: string) =>
            nfa.states.some((s) =>
                s.transitions.some(
                    (t) => t.type === "token" && t.tokens?.includes(tok),
                ),
            );
        expect(hasToken("donau")).toBe(true);
        expect(hasToken("dampf")).toBe(true);
        expect(hasToken("schiff")).toBe(true);
        expect(hasToken("fahrt")).toBe(true);
        expect(hasToken("donaudampfschifffahrt")).toBe(false);
    });

    it("matches partial fusions and fully spaced form", () => {
        expect(match(grammar, "Donau Dampfschifffahrt")).toHaveLength(1);
        expect(match(grammar, "Donaudampf Schifffahrt")).toHaveLength(1);
        expect(match(grammar, "Donau Dampf Schiff Fahrt")).toHaveLength(1);
    });

    it("stores no split candidates (Latin tokens are word-boundary-starting)", () => {
        const nfa = compileGrammarToNFA(grammar);
        const candidateStates = nfa.states.filter(
            (s) => s.splitCandidates && s.splitCandidates.length > 0,
        );
        expect(candidateStates).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// flex-space — Swahili agglutinative morphology
// ---------------------------------------------------------------------------
// Swahili (Kiswahili) is a Bantu language with rich prefix agglutination.
// Nouns carry a class prefix (e.g. ki- class 7 singular, vi- class 8 plural)
// and verbs carry a subject-agreement prefix + tense marker before the root —
// all concatenated into a single orthographic word with no separators.
//
// With separate StringParts and default spacing (auto), on-demand prefix
// splitting in the NFA queue handles fused input: "ki" is a prefix of
// "kitabu" → fork with ["ki","tabu"] → both spaced and fused forms match.
// ---------------------------------------------------------------------------

describe("flex-space — Swahili noun-class prefix (kitabu / vitabu = book / books)", () => {
    // Class 7 singular:  ki + tabu → kitabu  (book)
    // Class 8 plural:    vi + tabu → vitabu  (books)
    // The noun root "tabu" is shared; only the noun-class prefix changes.
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["ki"] },
                    { type: "string", value: ["tabu"] },
                ],
                value: { type: "literal", value: "book" },
            },
            {
                parts: [
                    { type: "string", value: ["vi"] },
                    { type: "string", value: ["tabu"] },
                ],
                value: { type: "literal", value: "books" },
            },
        ],
    };

    it("matches the fused singular form (kitabu) via prefix splitting", () => {
        const results = match(grammar, "kitabu");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(2); // 2 fixed tokens: ki + tabu
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches the fused plural form (vitabu) via prefix splitting", () => {
        const results = match(grammar, "vitabu");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(2); // 2 fixed tokens: vi + tabu
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("also matches space-separated forms (ki tabu / vi tabu)", () => {
        expect(match(grammar, "ki tabu")).toHaveLength(1);
        expect(match(grammar, "vi tabu")).toHaveLength(1);
    });

    it("NFA has separate token transitions (not fused)", () => {
        const nfa = compileGrammarToNFA(grammar);
        const hasToken = (tok: string) =>
            nfa.states.some((s) =>
                s.transitions.some(
                    (t) => t.type === "token" && t.tokens?.includes(tok),
                ),
            );
        expect(hasToken("ki")).toBe(true);
        expect(hasToken("vi")).toBe(true);
        expect(hasToken("tabu")).toBe(true);
        expect(hasToken("kitabu")).toBe(false);
        expect(hasToken("vitabu")).toBe(false);
    });
});

describe("flex-space — Swahili <Tense> rule reference: fused and spaced forms both match", () => {
    // Swahili verbs fuse three morphemes into one orthographic word:
    //   ni (1sg subject) + <tense> + soma (read)
    //
    //   ni + li (past)    + soma → nilisoma   (I read)
    //   ni + na (present) + soma → ninasoma   (I am reading)
    //   ni + ta (future)  + soma → nitasoma   (I will read)
    //
    // The tense marker is expressed as an inline RulesPart with three
    // alternatives.  With the default spacing (auto / required), the NFA has
    // separate token transitions for "ni", tense, and "soma".
    //
    // Spaced input  ("ni na soma")  matches directly via three token steps.
    // Fused input   ("ninasoma")    matches via on-demand prefix splitting:
    //   "ninasoma" → "ni" is a prefix → fork with ["ni","nasoma"]
    //   "nasoma"   → "na" is a prefix → fork with ["ni","na","soma"]
    //   "soma"     → exact match
    //
    // This is the same flex-space mechanism used for CJK (e.g. "黄色汽車").
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["ni"] },
                    {
                        type: "rules",
                        name: "Tense",
                        alternatives: [
                            {
                                parts: [{ type: "string", value: ["li"] }],
                            },
                            {
                                parts: [{ type: "string", value: ["na"] }],
                            },
                            {
                                parts: [{ type: "string", value: ["ta"] }],
                            },
                        ],
                    },
                    { type: "string", value: ["soma"] },
                ],
                // No spacingMode="none" — NFA has separate "ni"/"na"/"soma"
                // token transitions, so both spaced and fused input works.
                value: { type: "literal", value: "reading" },
            },
        ],
    };

    it("matches spaced past tense (ni li soma)", () => {
        const results = match(grammar, "ni li soma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 fixed tokens: ni + li + soma
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches spaced present tense (ni na soma)", () => {
        const results = match(grammar, "ni na soma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 fixed tokens: ni + na + soma
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches spaced future tense (ni ta soma)", () => {
        const results = match(grammar, "ni ta soma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 fixed tokens: ni + ta + soma
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches fused past tense (nilisoma) via on-demand splitting", () => {
        const results = match(grammar, "nilisoma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 tokens after split
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches fused present tense (ninasoma) via on-demand splitting", () => {
        const results = match(grammar, "ninasoma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 tokens after split
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches fused future tense (nitasoma) via on-demand splitting", () => {
        const results = match(grammar, "nitasoma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 tokens after split
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("does NOT match an unknown tense marker (nikusoma)", () => {
        // "ku" is the infinitive marker, not a finite tense in this grammar
        expect(match(grammar, "nikusoma")).toHaveLength(0);
    });

    it("NFA uses separate token transitions (not fused)", () => {
        const nfa = compileGrammarToNFA(grammar);
        // Separate transitions for each morpheme
        const hasToken = (tok: string) =>
            nfa.states.some((s) =>
                s.transitions.some(
                    (t) => t.type === "token" && t.tokens?.includes(tok),
                ),
            );
        expect(hasToken("ni")).toBe(true);
        expect(hasToken("na")).toBe(true);
        expect(hasToken("soma")).toBe(true);
        // No fused forms in the NFA
        expect(hasToken("ninasoma")).toBe(false);
        expect(hasToken("nilisoma")).toBe(false);
    });
});

describe("flex-space — Swahili subject-agreement: person variation (ninasoma / unasoma / anasoma)", () => {
    // The tense marker (na = present) and root (soma = read) are fixed;
    // the subject-agreement prefix varies by person:
    //
    //   ni (1sg) + na + soma → ninasoma   (I am reading)
    //   u  (2sg) + na + soma → unasoma    (you are reading)
    //   a  (3sg) + na + soma → anasoma    (he / she is reading)
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    { type: "string", value: ["ni"] },
                    { type: "string", value: ["na"] },
                    { type: "string", value: ["soma"] },
                ],
                value: { type: "literal", value: "I am reading" },
            },
            {
                parts: [
                    { type: "string", value: ["u"] },
                    { type: "string", value: ["na"] },
                    { type: "string", value: ["soma"] },
                ],
                value: { type: "literal", value: "you are reading" },
            },
            {
                parts: [
                    { type: "string", value: ["a"] },
                    { type: "string", value: ["na"] },
                    { type: "string", value: ["soma"] },
                ],
                value: { type: "literal", value: "he/she is reading" },
            },
        ],
    };

    it("matches first person fused (ninasoma) via prefix splitting", () => {
        const results = match(grammar, "ninasoma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 fixed tokens: ni + na + soma
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches second person fused (unasoma) via prefix splitting", () => {
        const results = match(grammar, "unasoma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 fixed tokens: u + na + soma
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("matches third person fused (anasoma) via prefix splitting", () => {
        const results = match(grammar, "anasoma");
        expect(results).toHaveLength(1);
        expect(results[0].matchedValueCount).toBe(3); // 3 fixed tokens: a + na + soma
        expect(results[0].wildcardCharCount).toBe(0);
    });

    it("also matches space-separated forms", () => {
        expect(match(grammar, "ni na soma")).toHaveLength(1);
        expect(match(grammar, "u na soma")).toHaveLength(1);
        expect(match(grammar, "a na soma")).toHaveLength(1);
    });

    it("does NOT match an unregistered subject prefix (tunasoma = we are reading)", () => {
        // tu (1pl) is not in the grammar — no prefix split can produce "tu"
        expect(match(grammar, "tunasoma")).toHaveLength(0);
    });
});
