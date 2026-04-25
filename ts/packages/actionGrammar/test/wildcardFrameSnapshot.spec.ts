// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Regression tests for wildcard-frame snapshot completeness.
//
// `pushWildcardFrame` snapshots the current `MatchState` so that a
// later `tryExtendWildcard` can `Object.assign` it back onto the live
// state.  Several `MatchState` fields are optional (`values`,
// `pendingWildcard`, `parent`, `suppressOptionalFork`, `lastMatchedPartInfo`) and
// may be assigned AFTER the snapshot is taken — e.g. `addValueWithId`
// commits the captured wildcard into `state.values` immediately after
// the snapshot, and entering a nested rule sets `state.parent`.
//
// If the snapshot doesn't contain those fields as OWN properties
// (because they were `undefined` at snapshot time and a plain spread
// only copies own enumerable properties), `Object.assign` won't reset
// them on extend — leaving stale post-snapshot state behind.  In
// these cases that manifests as `state.nestedLevel` being decremented
// below zero by `finalizeNestedRule` because a stale `parent` is
// re-traversed.
//
// The cases below set up a scenario where the only valid parse
// requires extending a wildcard AFTER the state has both committed
// captured values and entered a nested rule.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import type { Grammar } from "../src/grammarTypes.js";

function uniqueMatches(grammar: Grammar, request: string): string[] {
    const results = matchGrammar(grammar, request).map((m) =>
        JSON.stringify(m.match),
    );
    return Array.from(new Set(results)).sort();
}

describe("wildcard-frame snapshot completeness", () => {
    describe("optional-skip path after wildcard capture", () => {
        const g = `<Start> = $(x) end (opt)? tail -> { x };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("can extend wildcard cleanly via the skip-optional path", () => {
            // Input: "a end b end tail"
            // Viable parses:
            //  - shortest x="a", with (opt)?: "opt" at "b" → fail
            //  - shortest x="a", skip (opt)?: "tail" at "b" → fail
            //  - longer x="a end b", with (opt)?: "opt" at "tail" → fail
            //  - longer x="a end b", skip (opt)?: "tail" → MATCH
            //
            // The only valid parse requires extending the wildcard
            // after at least one shorter capture has been committed
            // and the alternative branches have been queued.
            const unique = uniqueMatches(grammar, "a end b end tail");
            expect(unique).toStrictEqual([JSON.stringify({ x: "a end b" })]);
        });
    });

    describe("rules-part alternative after wildcard capture", () => {
        // Use a sub-rule so the inner alternation's variables don't
        // need to leak into <Start>'s value expression.
        const g = `
            <body> = foo bar | bar;
            <Start> = $(x) end <body> -> { x };
        `;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("can extend wildcard cleanly across nested-rule alternatives", () => {
            // Input: "a end foo b end bar"
            // Viable parses:
            //  - alt1 "foo bar" with x="a":          "foo" ok, "bar" at "b" → fail
            //  - alt2 "bar"     with x="a":          "bar" at "foo" → fail
            //  - alt1 "foo bar" with x="a end foo b": remaining "bar" — "foo" fail
            //  - alt2 "bar"     with x="a end foo b": "bar" at "bar" → MATCH
            //
            // The only valid parse requires extending the wildcard
            // after the state has entered (and unwound from) a nested
            // rule, then re-entered an alternative nested rule.
            const unique = uniqueMatches(grammar, "a end foo b end bar");
            expect(unique).toStrictEqual([
                JSON.stringify({ x: "a end foo b" }),
            ]);
        });
    });
});
