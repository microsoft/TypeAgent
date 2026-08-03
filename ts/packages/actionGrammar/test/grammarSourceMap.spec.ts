// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import {
    buildGrammarSourceMap,
    findMatchedRule,
} from "../src/grammarSourceMap.js";
import type { DebugInfoCollector } from "../src/grammarCompiler.js";

function compileWithSourceMap(source: string) {
    const collector: DebugInfoCollector = {
        partPositions: new Map(),
        rulePositions: new Map(),
        partRules: new Map(),
        partLabels: new Map(),
        fileContents: new Map(),
        filePaths: new Map(),
    };
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow("test.agr", source, errors, [], {
        debugCollector: collector,
    });
    if (grammar === undefined) {
        throw new Error(errors.join("\n"));
    }
    return { grammar, sourceMap: buildGrammarSourceMap(collector) };
}

describe("grammar source map", () => {
    it("recovers the exact source text of the matched rule", () => {
        const source = `<Start> = <Pause> | <Play>;
<Pause> = pause -> { actionName: "pause" };
<Play> = play $(track:string) -> { actionName: "play", parameters: { track } };`;
        const { grammar, sourceMap } = compileWithSourceMap(source);

        const rule = findMatchedRule(
            sourceMap,
            grammar,
            "play yesterday",
            "play",
        )?.text;
        expect(rule).toContain("<Play>");
        expect(rule).toContain('actionName: "play"');
        expect(rule).not.toContain("<Pause>");
    });

    it("uses the action to skip a matched helper sub-rule", () => {
        const source = `<Start> = <Cmd>;
<Cmd> = play <Term> $(n:number) -> { actionName: "playNum", parameters: { n } };
<Term> = track | song;`;
        const { grammar, sourceMap } = compileWithSourceMap(source);

        // The last matched token ("track") belongs to <Term>, but the action
        // cross-check must return the emitting rule <Cmd>.
        const rule = findMatchedRule(
            sourceMap,
            grammar,
            "play track 3",
            "playNum",
        )?.text;
        expect(rule).toContain("<Cmd>");
        expect(rule).toContain('actionName: "playNum"');
        expect(rule?.startsWith("<Term>")).toBe(false);
    });

    it("returns undefined when the request does not match", () => {
        const source = `<Start> = <Pause>;
<Pause> = pause -> { actionName: "pause" };`;
        const { grammar, sourceMap } = compileWithSourceMap(source);

        expect(
            findMatchedRule(sourceMap, grammar, "fly to the moon", "pause")
                ?.text,
        ).toBeUndefined();
    });

    it("colors the request phrase by the category of each capture", () => {
        const source = `<Start> = <Play>;
<Play> = play $(track:<TrackPhrase>) by $(artist:<ArtistName>) -> { actionName: "play", parameters: { track, artist } };
<TrackPhrase> = $(x:wildcard);
<ArtistName> = $(x:wildcard);`;
        const { grammar, sourceMap } = compileWithSourceMap(source);

        const segments = findMatchedRule(
            sourceMap,
            grammar,
            "play shake it off by taylor swift",
            "play",
        )?.segments;
        expect(segments).toEqual([
            { text: "play", category: "" },
            { text: "shake it off", category: "TrackPhrase" },
            { text: "by", category: "" },
            { text: "taylor swift", category: "ArtistName" },
        ]);
    });
});
