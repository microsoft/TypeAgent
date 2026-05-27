// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    createStringPart,
    createWildcardPart,
    compileGrammarToNFA,
    registerBuiltInEntities,
    matchGrammarWithNFA,
} from "action-grammar";
import { findGrammarOverlap } from "../src/nfaIntersection.js";

/**
 * Tests for the NFA intersection / overlap detector used by
 * `@grammar collisions --full`.  Each test compiles a pair of grammars,
 * asks the detector for a witness, and validates the witness round-trips
 * by running it through the NFA matcher (the matcher is the source of
 * truth for what each grammar accepts, so a real overlap must produce a
 * witness that both matchers accept).
 */
describe("findGrammarOverlap", () => {
    beforeAll(() => {
        registerBuiltInEntities();
    });

    function nfa(g: Grammar, name: string) {
        return compileGrammarToNFA(g, name);
    }

    function bothMatch(g1: Grammar, g2: Grammar, witness: string[]): boolean {
        const r1 = matchGrammarWithNFA(g1, nfa(g1, "g1"), witness.join(" "));
        const r2 = matchGrammarWithNFA(g2, nfa(g2, "g2"), witness.join(" "));
        return r1.length > 0 && r2.length > 0;
    }

    /**
     * Multi-term rules require an explicit value expression.  Tests don't
     * care about the action shape; pin a literal so compilation succeeds.
     */
    const literalValue = { type: "literal" as const, value: true };

    it("detects literal-prefix overlap with a concrete witness", () => {
        const a: Grammar = {
            alternatives: [{ parts: [createStringPart(["play"])] }],
        };
        const b: Grammar = {
            alternatives: [{ parts: [createStringPart(["play"])] }],
        };
        const overlap = findGrammarOverlap(nfa(a, "A"), nfa(b, "B"));
        expect(overlap).toBeDefined();
        expect(overlap!.witness).toEqual(["play"]);
        expect(overlap!.hasPlaceholders).toBe(false);
        expect(bothMatch(a, b, overlap!.witness)).toBe(true);
    });

    it("detects overlap when one side is more specific (literal vs wildcard)", () => {
        // A: "stop the music"
        // B: "stop $(thing:string)"
        // → overlap: "stop the" or "stop music" or "stop the music".  Any
        //   single-token witness for $(thing:string) suffices.
        const a: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["stop"]),
                        createStringPart(["the"]),
                        createStringPart(["music"]),
                    ],
                    value: literalValue,
                },
            ],
        };
        const b: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["stop"]),
                        createWildcardPart("thing", "string"),
                    ],
                    value: literalValue,
                },
            ],
        };
        const overlap = findGrammarOverlap(nfa(a, "A"), nfa(b, "B"));
        expect(overlap).toBeDefined();
        expect(overlap!.witness[0]).toBe("stop");
        expect(overlap!.hasPlaceholders).toBe(false);
        // The witness must be accepted by both grammars.
        expect(bothMatch(a, b, overlap!.witness)).toBe(true);
    });

    it("returns undefined for grammars with disjoint literal prefixes", () => {
        const a: Grammar = {
            alternatives: [{ parts: [createStringPart(["pause"])] }],
        };
        const b: Grammar = {
            alternatives: [{ parts: [createStringPart(["resume"])] }],
        };
        const overlap = findGrammarOverlap(nfa(a, "A"), nfa(b, "B"));
        expect(overlap).toBeUndefined();
    });

    it("returns undefined when wildcard types are incompatible with literals", () => {
        // A: "set volume $(n:number)"  — wildcard requires a number
        // B: "set volume loud"          — literal "loud" is not a number
        // No overlap on the third token.
        const a: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["set"]),
                        createStringPart(["volume"]),
                        createWildcardPart("n", "number"),
                    ],
                    value: literalValue,
                },
            ],
        };
        const b: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["set"]),
                        createStringPart(["volume"]),
                        createStringPart(["loud"]),
                    ],
                    value: literalValue,
                },
            ],
        };
        const overlap = findGrammarOverlap(nfa(a, "A"), nfa(b, "B"));
        expect(overlap).toBeUndefined();
    });

    it("detects overlap when wildcard accepts the literal (number wildcard vs '42')", () => {
        const a: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["set"]),
                        createWildcardPart("n", "number"),
                    ],
                    value: literalValue,
                },
            ],
        };
        const b: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["set"]),
                        createStringPart(["42"]),
                    ],
                    value: literalValue,
                },
            ],
        };
        const overlap = findGrammarOverlap(nfa(a, "A"), nfa(b, "B"));
        expect(overlap).toBeDefined();
        expect(overlap!.witness).toEqual(["set", "42"]);
        expect(overlap!.hasPlaceholders).toBe(false);
        expect(bothMatch(a, b, overlap!.witness)).toBe(true);
    });

    it("returns the shortest witness when multiple paths overlap", () => {
        // A has two alternatives: "go" and "go home now"
        // B has two alternatives: "go" and "stop"
        // The shortest joint accept is just ["go"].
        const a: Grammar = {
            alternatives: [
                { parts: [createStringPart(["go"])] },
                {
                    parts: [
                        createStringPart(["go"]),
                        createStringPart(["home"]),
                        createStringPart(["now"]),
                    ],
                    value: literalValue,
                },
            ],
        };
        const b: Grammar = {
            alternatives: [
                { parts: [createStringPart(["go"])] },
                { parts: [createStringPart(["stop"])] },
            ],
        };
        const overlap = findGrammarOverlap(nfa(a, "A"), nfa(b, "B"));
        expect(overlap).toBeDefined();
        expect(overlap!.witness).toEqual(["go"]);
    });

    it("flags hasPlaceholders when both sides require custom entity types", () => {
        // Both wildcards have a custom typeName for which no validator is
        // registered.  The detector reports overlap with a synthetic
        // placeholder rather than missing the case.
        const a: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["call"]),
                        createWildcardPart("x", "UnregisteredType"),
                    ],
                    value: literalValue,
                },
            ],
        };
        const b: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["call"]),
                        createWildcardPart("y", "UnregisteredType"),
                    ],
                    value: literalValue,
                },
            ],
        };
        const overlap = findGrammarOverlap(nfa(a, "A"), nfa(b, "B"));
        expect(overlap).toBeDefined();
        expect(overlap!.hasPlaceholders).toBe(true);
        expect(overlap!.witness[0]).toBe("call");
    });

    it("attributes the witness to the specific colliding rule", () => {
        // A has two top-level alternatives; only the second collides with B.
        const a: Grammar = {
            alternatives: [
                { parts: [createStringPart(["delete"])] }, // rule 0
                { parts: [createStringPart(["search"])] }, // rule 1
            ],
        };
        const b: Grammar = {
            alternatives: [
                { parts: [createStringPart(["search"])] }, // rule 0
            ],
        };
        const overlap = findGrammarOverlap(nfa(a, "A"), nfa(b, "B"));
        expect(overlap).toBeDefined();
        expect(overlap!.witness).toEqual(["search"]);
        // Rule attribution: A's colliding rule is index 1, B's is index 0.
        expect(overlap!.ruleIndexA).toBe(1);
        expect(overlap!.ruleIndexB).toBe(0);
    });
});
