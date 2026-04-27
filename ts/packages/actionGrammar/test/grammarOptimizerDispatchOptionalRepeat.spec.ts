// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for `DispatchPart` carrying `optional` / `repeat` flags.
 * Until recently the optimizer skipped any RulesPart with `repeat`
 * or `optional` set; now those flags are propagated through to the
 * synthesized DispatchPart and the matcher's optional-fork / repeat
 * re-entry handle them uniformly with the underlying RulesPart
 * path.  These tests pin the behavior:
 *
 *   - Optional dispatch group: present and absent.
 *   - Repeat dispatch group: zero / one / many iterations, plus
 *     iterations dispatching to different buckets.
 *   - Nested optional inside repeat (epsilon-iteration interaction).
 *   - JSON round-trip preserves the new flags.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import { grammarFromJson } from "../src/grammarDeserializer.js";
import {
    findDispatchPart,
    getDispatchAllTokenMap,
    match,
} from "./dispatchTestHelpers.js";

describe("Grammar Optimizer - DispatchPart with optional/repeat", () => {
    describe("optional dispatch", () => {
        const text = `<Start> = hello (foo | bar | baz)? -> true;`;

        it("emits a DispatchPart with optional=true", () => {
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            const dispatch = findDispatchPart(optimized);
            expect(dispatch).toBeDefined();
            expect(dispatch!.optional).toBe(true);
            expect(
                Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
            ).toEqual(["bar", "baz", "foo"]);
        });

        it("matches identically to the unoptimized grammar", () => {
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            for (const input of [
                "hello",
                "hello foo",
                "hello bar",
                "hello baz",
                "hello qux",
            ]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });
    });

    describe("repeat dispatch", () => {
        const text = `<Start> = (foo | bar | baz)* -> true;`;

        it("emits a DispatchPart with repeat=true", () => {
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            const dispatch = findDispatchPart(optimized);
            expect(dispatch).toBeDefined();
            expect(dispatch!.repeat).toBe(true);
            expect(
                Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
            ).toEqual(["bar", "baz", "foo"]);
        });

        it("re-peeks per iteration and matches identically", () => {
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            // Each iteration's first token may dispatch to a
            // different bucket - the matcher's repeat re-entry must
            // re-run the dispatch peek.
            for (const input of [
                "",
                "foo",
                "foo bar",
                "bar baz foo",
                "foo foo foo",
                "qux",
                "foo qux",
            ]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });
    });

    describe("optional + repeat combinations", () => {
        // Nested ((a | b)?)* shape exercises the optional-fork
        // running before the dispatch arm and the repeat re-entry
        // re-running the dispatch peek.
        const text = `<Start> = ((foo | bar)?)* -> true;`;

        it("matches identically to the unoptimized grammar", () => {
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            for (const input of ["", "foo", "foo bar", "bar foo bar", "qux"]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });
    });

    describe("JSON round-trip", () => {
        it("preserves optional/repeat flags on DispatchPart", () => {
            const text = `<Start> = (foo | bar)* (baz | qux)? -> true;`;
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            const roundTripped = grammarFromJson(grammarToJson(optimized));
            for (const input of [
                "",
                "foo",
                "foo bar baz",
                "foo foo qux",
                "baz",
            ]) {
                expect(match(roundTripped, input)).toStrictEqual(
                    match(optimized, input),
                );
            }
        });
    });
});
