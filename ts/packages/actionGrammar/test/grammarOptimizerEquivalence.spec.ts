// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";

const grammars: { name: string; text: string; inputs: string[] }[] = [
    {
        name: "player-like",
        text: `<Start> = <Cmd>;
<Cmd> = play $(track:string) -> { actionName: "play", track }
      | pause -> { actionName: "pause" }
      | stop -> { actionName: "stop" };`,
        inputs: ["play hello", "pause", "stop", "unknown"],
    },
    {
        name: "shared-prefix-three-way",
        text: `<Start> = <C>;
<C> = play the song -> "song"
    | play the track -> "track"
    | play the album -> "album";`,
        inputs: [
            "play the song",
            "play the track",
            "play the album",
            "play the",
        ],
    },
    {
        name: "wrapper-rule",
        text: `<Start> = <Wrap>;
<Wrap> = <Inner>;
<Inner> = hello world;`,
        inputs: ["hello world", "hello", "world"],
    },
    {
        name: "variable-rename-across-alternatives",
        text: `<Start> = <C>;
<C> = play $(a:string) once -> { kind: "once", a }
    | play $(b:string) twice -> { kind: "twice", v: b };`,
        inputs: ["play hello once", "play hello twice", "play hello"],
    },
    {
        name: "value-on-wrapper",
        text: `<Start> = <Wrap>;
<Wrap> = hello -> { greeting: true };`,
        inputs: ["hello", "bye"],
    },
];

const flagCombos: {
    name: string;
    opts: {
        inlineSingleAlternatives?: boolean;
        factorCommonPrefixes?: boolean;
    };
}[] = [
    { name: "inline-only", opts: { inlineSingleAlternatives: true } },
    { name: "factor-only", opts: { factorCommonPrefixes: true } },
    {
        name: "both",
        opts: {
            inlineSingleAlternatives: true,
            factorCommonPrefixes: true,
        },
    },
];

function matchAll(
    grammar: ReturnType<typeof loadGrammarRules>,
    request: string,
) {
    const out = matchGrammar(grammar, request).map((m) => ({
        match: m.match,
    }));
    // Sort for stable comparison — match order across optimizer combos
    // may differ but the multi-set of results must agree.
    return out.map((x) => JSON.stringify(x.match)).sort();
}

describe("Grammar Optimizer - Match equivalence", () => {
    for (const g of grammars) {
        describe(`grammar: ${g.name}`, () => {
            const baseline = loadGrammarRules("t.grammar", g.text);
            for (const combo of flagCombos) {
                const optimized = loadGrammarRules("t.grammar", g.text, {
                    optimizations: combo.opts,
                });
                for (const input of g.inputs) {
                    it(`[${combo.name}] '${input}'`, () => {
                        expect(matchAll(optimized, input)).toStrictEqual(
                            matchAll(baseline, input),
                        );
                    });
                }
            }
        });
    }
});
