// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Stage 1 foundation tests for StringPart / PhraseSetPart variable capture.
 *
 * These bindings have no source syntax — they're produced only by the
 * optimizer's inliner pass.  Tests construct grammars manually to exercise
 * the matcher / NFA / DFA capture paths in isolation, before any optimizer
 * code emits these forms.
 *
 * Coverage:
 *   - matchGrammar (interpreter): StringPart capture (single + multi-token)
 *   - matchGrammarWithNFA: StringPart and PhraseSetPart capture
 *   - matchDFAWithSplitting: StringPart and PhraseSetPart capture (delegates
 *     to matchNFA via dfa.sourceNFA)
 *   - JSON round-trip: variable preserved through serialize/deserialize
 *
 * grammarMatcher.ts has no PhraseSetPart match path — phraseSet capture is
 * exercised only against the NFA / DFA matchers.
 */

import { matchGrammar } from "../src/grammarMatcher.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchGrammarWithNFA, tokenizeRequest } from "../src/nfaMatcher.js";
import { compileNFAToDFA } from "../src/dfaCompiler.js";
import { matchDFAWithSplitting } from "../src/dfaMatcher.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import { grammarFromJson } from "../src/grammarDeserializer.js";
import type { Grammar } from "../src/grammarTypes.js";

function bestNfaActionValue(grammar: Grammar, request: string): unknown {
    const nfa = compileGrammarToNFA(grammar, "test.grammar");
    const results = matchGrammarWithNFA(grammar, nfa, request);
    // Each test grammar here has exactly one rule, so any successful
    // match must have produced the same action value regardless of
    // result ordering.  Return the first match (or undefined when the
    // grammar didn't match).  Asserting via the set of all matches
    // would be more robust against future ordering changes — but with
    // a single-rule grammar there's at most one distinct value.
    if (results.length === 0) return undefined;
    const distinct = new Set(results.map((r) => JSON.stringify(r.match)));
    if (distinct.size > 1) {
        throw new Error(
            `Expected a single distinct action value, got ${distinct.size}: ${[...distinct].join(", ")}`,
        );
    }
    return results[0].match;
}

function bestDfaActionValue(grammar: Grammar, request: string): unknown {
    const nfa = compileGrammarToNFA(grammar, "test.grammar");
    const dfa = compileNFAToDFA(nfa, "test.grammar");
    const tokens = tokenizeRequest(request);
    const result = matchDFAWithSplitting(dfa, tokens);
    return result.matched ? result.actionValue : undefined;
}

describe("StringPart variable capture", () => {
    // <Start> = "hello" -> { greeting: <captured "hello"> }
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    {
                        type: "string",
                        value: ["hello"],
                        variable: "greeting",
                    },
                ],
                value: { type: "variable", name: "greeting" },
            },
        ],
    };

    it("interpreter: single-token StringPart binds joined value", () => {
        const matches = matchGrammar(grammar, "hello");
        expect(matches?.map((m) => m.match)).toStrictEqual(["hello"]);
    });

    it("NFA: single-token StringPart binds joined value", () => {
        expect(bestNfaActionValue(grammar, "hello")).toBe("hello");
    });

    it("DFA: single-token StringPart binds joined value", () => {
        expect(bestDfaActionValue(grammar, "hello")).toBe("hello");
    });

    // Multi-token StringPart should write the joined fixed string,
    // once, on the final transition of the chain.
    const multiTokenGrammar: Grammar = {
        alternatives: [
            {
                parts: [
                    {
                        type: "string",
                        value: ["good", "morning"],
                        variable: "greeting",
                    },
                ],
                value: { type: "variable", name: "greeting" },
            },
        ],
    };

    it("interpreter: multi-token StringPart binds joined value", () => {
        const matches = matchGrammar(multiTokenGrammar, "good morning");
        expect(matches?.map((m) => m.match)).toStrictEqual(["good morning"]);
    });

    it("NFA: multi-token StringPart binds joined value", () => {
        expect(bestNfaActionValue(multiTokenGrammar, "good morning")).toBe(
            "good morning",
        );
    });

    it("DFA: multi-token StringPart binds joined value", () => {
        expect(bestDfaActionValue(multiTokenGrammar, "good morning")).toBe(
            "good morning",
        );
    });

    // Mixed multi-part rule: the StringPart capture coexists with a
    // wildcard capture in the same parent rule.  The value expression
    // references both.
    const mixedGrammar: Grammar = {
        alternatives: [
            {
                parts: [
                    {
                        type: "string",
                        value: ["greet"],
                        variable: "verb",
                    },
                    {
                        type: "wildcard",
                        typeName: "string",
                        variable: "name",
                    },
                ],
                value: {
                    type: "object",
                    value: [
                        {
                            type: "property",
                            key: "verb",
                            value: { type: "variable", name: "verb" },
                        },
                        {
                            type: "property",
                            key: "name",
                            value: { type: "variable", name: "name" },
                        },
                    ],
                },
            },
        ],
    };

    it("interpreter: StringPart capture coexists with wildcard capture", () => {
        const matches = matchGrammar(mixedGrammar, "greet alice");
        expect(matches?.map((m) => m.match)).toStrictEqual([
            { verb: "greet", name: "alice" },
        ]);
    });

    it("NFA: StringPart capture coexists with wildcard capture", () => {
        expect(bestNfaActionValue(mixedGrammar, "greet alice")).toStrictEqual({
            verb: "greet",
            name: "alice",
        });
    });

    it("DFA: StringPart capture coexists with wildcard capture", () => {
        expect(bestDfaActionValue(mixedGrammar, "greet alice")).toStrictEqual({
            verb: "greet",
            name: "alice",
        });
    });
});

describe("PhraseSetPart variable capture", () => {
    // <Start> = <Polite> "go" -> { opener: <captured polite phrase>, action: "go" }
    const grammar: Grammar = {
        alternatives: [
            {
                parts: [
                    {
                        type: "phraseSet",
                        matcherName: "Polite",
                        variable: "opener",
                    },
                    { type: "string", value: ["go"] },
                ],
                value: {
                    type: "object",
                    value: [
                        {
                            type: "property",
                            key: "opener",
                            value: { type: "variable", name: "opener" },
                        },
                    ],
                },
            },
        ],
    };

    it("NFA: PhraseSetPart binds matched phrase tokens joined", () => {
        // "Polite" set includes "please", "could you", "would you", etc.
        expect(bestNfaActionValue(grammar, "please go")).toStrictEqual({
            opener: "please",
        });
        expect(bestNfaActionValue(grammar, "could you go")).toStrictEqual({
            opener: "could you",
        });
    });

    it("DFA: PhraseSetPart binds matched phrase tokens joined", () => {
        expect(bestDfaActionValue(grammar, "please go")).toStrictEqual({
            opener: "please",
        });
        expect(bestDfaActionValue(grammar, "could you go")).toStrictEqual({
            opener: "could you",
        });
    });
});

describe("Serialization round-trip preserves variable", () => {
    it("StringPart variable survives JSON round-trip", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        {
                            type: "string",
                            value: ["hi"],
                            variable: "v",
                        },
                    ],
                    value: { type: "variable", name: "v" },
                },
            ],
        };
        const json = grammarToJson(grammar);
        const restored = grammarFromJson(json);
        const part = restored.alternatives[0].parts[0];
        expect(part.type).toBe("string");
        expect((part as { variable?: string }).variable).toBe("v");
    });

    it("PhraseSetPart variable survives JSON round-trip", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        {
                            type: "phraseSet",
                            matcherName: "Polite",
                            variable: "v",
                        },
                        { type: "string", value: ["go"] },
                    ],
                    value: { type: "variable", name: "v" },
                },
            ],
        };
        const json = grammarToJson(grammar);
        const restored = grammarFromJson(json);
        const part = restored.alternatives[0].parts[0];
        expect(part.type).toBe("phraseSet");
        expect((part as { variable?: string }).variable).toBe("v");
    });
});
