// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    compileGrammarToNFA,
    grammarFromJson,
    grammarToJson,
    loadGrammarRules,
    matchGrammarWithNFA,
    nfaCompatibleOptimizations,
} from "../src/index.js";

describe("shared grammar artifact optimization", () => {
    it("round-trips optimized artifacts and preserves typed input matching through NFA", () => {
        const grammar = loadGrammarRules(
            "macro.agr",
            `<Start> = (find | open) (the | a) $(topic:string) document
                -> { actionName: "lookup", parameters: { topic } };`,
            { optimizations: nfaCompatibleOptimizations },
        );
        const artifact = grammarFromJson(
            JSON.parse(JSON.stringify(grammarToJson(grammar))),
        );
        const nfa = compileGrammarToNFA(artifact);
        for (const request of [
            "find the Orion document",
            "open a Vega document",
        ]) {
            expect(
                matchGrammarWithNFA(artifact, nfa, request).map(
                    (match) => match.match,
                ),
            ).toEqual([
                {
                    actionName: "lookup",
                    parameters: {
                        topic: request.includes("Orion") ? "Orion" : "Vega",
                    },
                },
            ]);
        }
        expect(
            matchGrammarWithNFA(artifact, nfa, "delete all documents"),
        ).toEqual([]);
    });
});
