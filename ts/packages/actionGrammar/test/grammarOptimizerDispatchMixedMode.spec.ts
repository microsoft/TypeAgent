// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for mixed-mode `DispatchPart` (Approach A): a single
 * alternation whose members carry different `spacingMode` values
 * is now dispatch-eligible.  The optimizer partitions members by
 * each rule's own spacing mode and builds a separate `tokenMap`
 * per dispatch-eligible mode (`required` and/or `undefined`/auto).
 * At match time the matcher peeks once per `perMode` entry and
 * unions the hits.
 *
 * Coverage:
 *   - A partition mixing `auto` and `required` members produces a
 *     `DispatchPart` with two `perMode` entries.
 *   - A partition mixing `auto` and `optional`/`none` members
 *     dispatches the auto half and routes the
 *     optional/none member to `fallback`.
 *   - Match results are identical to the no-dispatch baseline for
 *     every input across every shape.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import {
    DispatchedRulesPart,
    findDispatchPart,
} from "./dispatchTestHelpers.js";

function compareWithBaseline(
    schema: string,
    inputs: string[],
): {
    optimized: ReturnType<typeof loadGrammarRules>;
    dispatch: DispatchedRulesPart | undefined;
} {
    const baseline = loadGrammarRules("t.grammar", schema, {
        optimizations: { dispatchifyAlternations: false },
    });
    const optimized = loadGrammarRules("t.grammar", schema, {
        optimizations: { dispatchifyAlternations: true },
    });
    for (const input of inputs) {
        const got = matchGrammar(optimized, input)
            .map((m) => JSON.stringify(m.match))
            .sort();
        const exp = matchGrammar(baseline, input)
            .map((m) => JSON.stringify(m.match))
            .sort();
        expect(got).toStrictEqual(exp);
    }
    return { optimized, dispatch: findDispatchPart(optimized) };
}

describe("Grammar Optimizer - mixed-mode DispatchPart", () => {
    it("partitions mixed required/auto members into per-mode buckets", () => {
        // Two auto-mode members ("alpha"/"beta") and two required-mode
        // members ("gamma"/"delta").  All four eligible; perMode
        // should have entries for both `undefined` and `required`.
        const SCHEMA = `<Start> = alpha one -> "a"
                              | beta two -> "b"
                              | [spacing=required] gamma three -> "g"
                              | [spacing=required] delta four -> "d";`;

        const { dispatch } = compareWithBaseline(SCHEMA, [
            "alpha one",
            "beta two",
            "gamma three",
            "delta four",
            "alpha two", // partial mismatch
            "epsilon", // peek miss
            "",
        ]);

        expect(dispatch).toBeDefined();
        expect(dispatch!.dispatch).toHaveLength(2);
        // The auto entry comes first since the source order opens
        // with the two auto-mode rules; the required entry follows.
        expect(dispatch!.dispatch[0].spacingMode).toBeUndefined();
        expect(
            Array.from(dispatch!.dispatch[0].tokenMap.keys()).sort(),
        ).toStrictEqual(["alpha", "beta"]);
        expect(dispatch!.dispatch[1].spacingMode).toBe("required");
        expect(
            Array.from(dispatch!.dispatch[1].tokenMap.keys()).sort(),
        ).toStrictEqual(["delta", "gamma"]);
    });

    it("routes optional-mode members to fallback while dispatching the rest", () => {
        // Three auto-mode members + one [spacing=optional] member
        // whose first token would otherwise bucket on "zeta".  The
        // optional member can't peek-dispatch (its StringPart regex
        // tolerates zero leading separators), so it lands in
        // fallback; the other three form a single-mode perMode
        // entry.
        const SCHEMA = `<Start> = alpha one -> "a"
                              | beta two -> "b"
                              | gamma three -> "g"
                              | [spacing=optional] zeta four -> "z";`;

        const { dispatch } = compareWithBaseline(SCHEMA, [
            "alpha one",
            "beta two",
            "gamma three",
            "zeta four",
            "zetafour",
            "epsilon",
            "",
        ]);

        expect(dispatch).toBeDefined();
        expect(dispatch!.dispatch).toHaveLength(1);
        expect(dispatch!.dispatch[0].spacingMode).toBeUndefined();
        expect(
            Array.from(dispatch!.dispatch[0].tokenMap.keys()).sort(),
        ).toStrictEqual(["alpha", "beta", "gamma"]);
        expect(dispatch!.alternatives).toHaveLength(1);
    });

    it("preserves member-source order of first appearance in perMode", () => {
        // Required appears first; perMode[0] should be required,
        // perMode[1] auto.  (Inverse of the first test, where auto
        // led.)
        const SCHEMA = `<Start> = [spacing=required] gamma three -> "g"
                              | alpha one -> "a"
                              | [spacing=required] delta four -> "d"
                              | beta two -> "b";`;

        const { dispatch } = compareWithBaseline(SCHEMA, [
            "alpha one",
            "beta two",
            "gamma three",
            "delta four",
        ]);

        expect(dispatch).toBeDefined();
        expect(dispatch!.dispatch).toHaveLength(2);
        expect(dispatch!.dispatch[0].spacingMode).toBe("required");
        expect(dispatch!.dispatch[1].spacingMode).toBeUndefined();
    });

    it("matches identically when the same first token appears under both modes", () => {
        // Same leading token "play" under auto and required - both
        // perMode entries' peek can hit on the same input.  Matcher
        // unions the hits via the multi-bucket merge cache.
        const SCHEMA = `<Start> = play song -> "auto-song"
                              | [spacing=required] play album -> "req-album";`;

        const { dispatch } = compareWithBaseline(SCHEMA, [
            "play song",
            "play album",
            "play",
            "play other",
        ]);

        expect(dispatch).toBeDefined();
        expect(dispatch!.dispatch).toHaveLength(2);
        for (const m of dispatch!.dispatch) {
            expect(m.tokenMap.has("play")).toBe(true);
        }
    });
});
