// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammarCompletion } from "../src/grammarMatcher.js";

describe("Grammar Completion - matchedPrefixLength", () => {
    describe("single string part", () => {
        // All words in one string part — matchedPrefixLength is always 0
        // because the completion is the full string part text.
        const g = `<Start> = play music -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("returns full part as completion for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toEqual(["play music"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("returns full part as completion for partial prefix", () => {
            const result = matchGrammarCompletion(grammar, "pl");
            expect(result.completions).toEqual(["play music"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("returns full part as completion for first word typed", () => {
            const result = matchGrammarCompletion(grammar, "play ");
            expect(result.completions).toEqual(["play music"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("returns all first parts for non-matching input", () => {
            const result = matchGrammarCompletion(grammar, "xyz");
            // Nothing consumed; the first string part is offered
            // unconditionally so the caller can filter by trailing text.
            expect(result.completions).toEqual(["play music"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("returns matchedPrefixLength for exact match", () => {
            const result = matchGrammarCompletion(grammar, "play music");
            expect(result.completions).toHaveLength(0);
            // Exact match now records the full consumed length.
            expect(result.matchedPrefixLength).toBe(10);
        });
    });

    describe("multi-part via nested rule", () => {
        // Nested rule creates separate parts, so matchedPrefixLength
        // reflects the position after the consumed nested rule.
        const g = [
            `<Start> = $(v:<Verb>) music -> true;`,
            `<Verb> = play -> true;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("returns nested rule text for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toEqual(["play"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("returns second part after nested rule consumed", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.completions).toEqual(["music"]);
            expect(result.matchedPrefixLength).toBe(4);
        });

        it("returns second part after nested rule with trailing space", () => {
            const result = matchGrammarCompletion(grammar, "play ");
            expect(result.completions).toEqual(["music"]);
            expect(result.matchedPrefixLength).toBe(4);
        });

        it("returns second part for partial second word", () => {
            const result = matchGrammarCompletion(grammar, "play m");
            expect(result.completions).toEqual(["music"]);
            expect(result.matchedPrefixLength).toBe(4);
        });

        it("returns matchedPrefixLength for complete match", () => {
            const result = matchGrammarCompletion(grammar, "play music");
            expect(result.completions).toHaveLength(0);
            expect(result.matchedPrefixLength).toBe(10);
        });
    });

    describe("multiple rules with shared prefix", () => {
        // Multiple rules that share a prefix via nested rules
        const g = [
            `<Start> = $(v:<Verb>) music -> "play_music";`,
            `<Start> = $(v:<Verb>) video -> "play_video";`,
            `<Verb> = play -> true;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("returns both completions after shared prefix", () => {
            const result = matchGrammarCompletion(grammar, "play ");
            expect(result.completions.sort()).toEqual(["music", "video"]);
            expect(result.matchedPrefixLength).toBe(4);
        });
    });

    describe("wildcard with terminator", () => {
        // Wildcard between string parts: "play $(name) now"
        const g = `<Start> = play $(name) now -> { name: name };`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("returns wildcard property (not terminator) when only separator follows wildcard start", () => {
            // "play " — the trailing space is only a separator, not valid
            // wildcard content, so the wildcard can't finalize and we fall
            // through to the property-completion path instead of offering
            // the terminator string.
            const result = matchGrammarCompletion(grammar, "play ");
            expect(result.completions).toEqual([]);
            expect(result.matchedPrefixLength).toBe(4);
        });

        it("returns terminator with matchedPrefixLength tracking wildcard text", () => {
            const result = matchGrammarCompletion(grammar, "play hello");
            expect(result.completions).toEqual(["now"]);
            // Wildcard consumed "hello" — matchedPrefixLength includes it
            expect(result.matchedPrefixLength).toBe(10);
        });

        it("returns terminator with matchedPrefixLength for trailing space", () => {
            const result = matchGrammarCompletion(grammar, "play hello ");
            expect(result.completions).toEqual(["now"]);
            expect(result.matchedPrefixLength).toBe(11);
        });
    });

    describe("wildcard without terminator", () => {
        const g = `<Start> = play $(name) -> { name: name };`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("returns start rule for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toEqual(["play"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("returns property completion for separator-only trailing wildcard", () => {
            // The trailing space is not valid wildcard content, so the
            // wildcard can't finalize.  The else-branch produces a
            // property completion instead, setting matchedPrefixLength to
            // the wildcard start position.
            const result = matchGrammarCompletion(grammar, "play ");
            expect(result.completions).toHaveLength(0);
            expect(result.matchedPrefixLength).toBe(4);
        });
    });

    describe("CJK multi-part with nested rule", () => {
        // CJK requires multi-part grammar for meaningful matchedPrefixLength
        const g = [
            `<Start> [spacing=auto] = $(v:<Verb>) 音楽 -> true;`,
            `<Verb> [spacing=auto] = 再生 -> true;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("returns verb for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toEqual(["再生"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("returns noun completion after CJK verb typed", () => {
            const result = matchGrammarCompletion(grammar, "再生");
            expect(result.completions).toEqual(["音楽"]);
            // "再生" is 2 chars; matchedPrefixLength reflects position after verb
            expect(result.matchedPrefixLength).toBe(2);
        });

        it("returns noun completion after CJK verb with space", () => {
            const result = matchGrammarCompletion(grammar, "再生 ");
            expect(result.completions).toEqual(["音楽"]);
            expect(result.matchedPrefixLength).toBe(2);
        });

        it("returns no completions for exact match", () => {
            const result = matchGrammarCompletion(grammar, "再生音楽");
            expect(result.completions).toHaveLength(0);
            expect(result.matchedPrefixLength).toBe(4);
        });
    });

    describe("CJK single string part", () => {
        // Single string part — matchedPrefixLength is 0 (all text in one part)
        const g = `<Start> [spacing=auto] = 再生 音楽 -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("returns full part for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toEqual(["再生 音楽"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("returns full part for partial CJK prefix", () => {
            const result = matchGrammarCompletion(grammar, "再生");
            expect(result.completions).toEqual(["再生 音楽"]);
            expect(result.matchedPrefixLength).toBe(0);
        });
    });

    describe("CJK wildcard", () => {
        const g = `<Start> [spacing=auto] = 再生 $(name) 停止 -> { name: name };`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("returns property completion when only separator follows CJK wildcard start", () => {
            // Same as the Latin case: trailing space is a separator, not
            // valid wildcard content, so the terminator isn't offered.
            const result = matchGrammarCompletion(grammar, "再生 ");
            expect(result.completions).toEqual([]);
            expect(result.matchedPrefixLength).toBe(2);
        });

        it("returns terminator after CJK prefix + wildcard text", () => {
            const result = matchGrammarCompletion(grammar, "再生 hello");
            expect(result.completions).toEqual(["停止"]);
            expect(result.matchedPrefixLength).toBe(8);
        });
    });

    describe("separatorMode - Latin multi-part", () => {
        // Latin grammar: "play" → "music" requires a space separator
        const g = [
            `<Start> = $(v:<Verb>) music -> true;`,
            `<Verb> = play -> true;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("reports separatorMode for Latin 'play' → 'music'", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.completions).toEqual(["music"]);
            expect(result.separatorMode).toBe("spacePunctuation");
        });

        it("reports separatorMode even when trailing space exists", () => {
            const result = matchGrammarCompletion(grammar, "play ");
            expect(result.completions).toEqual(["music"]);
            // matchedPrefixLength is 4 ("play"); the trailing space is
            // unmatched content beyond that boundary.  separatorMode
            // describes the boundary at matchedPrefixLength, so it is
            // "spacePunctuation" (Latin "y" → "m" needs a separator).
            expect(result.matchedPrefixLength).toBe(4);
            expect(result.separatorMode).toBe("spacePunctuation");
        });

        it("reports optional separatorMode for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toEqual(["play"]);
            expect(result.separatorMode).toBe("optional");
        });

        it("reports optional separatorMode for partial prefix match", () => {
            // "pl" matches partially → the completion replaces from state.index,
            // so no separator needed (user is typing the keyword)
            const result = matchGrammarCompletion(grammar, "pl");
            expect(result.completions).toEqual(["play"]);
            expect(result.separatorMode).toBe("optional");
        });
    });

    describe("separatorMode - CJK multi-part", () => {
        // CJK grammar: "再生" → "音楽" does NOT require a space separator
        const g = [
            `<Start> [spacing=auto] = $(v:<Verb>) 音楽 -> true;`,
            `<Verb> [spacing=auto] = 再生 -> true;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("reports optional separatorMode for CJK '再生' → '音楽'", () => {
            const result = matchGrammarCompletion(grammar, "再生");
            expect(result.completions).toEqual(["音楽"]);
            // CJK → CJK in auto mode: separator optional
            expect(result.separatorMode).toBe("optional");
        });
    });

    describe("separatorMode - mixed scripts", () => {
        // Latin followed by CJK: no separator needed in auto mode
        const g = [
            `<Start> [spacing=auto] = $(v:<Verb>) 音楽 -> true;`,
            `<Verb> [spacing=auto] = play -> true;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("reports optional separatorMode for Latin 'play' → CJK '音楽'", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.completions).toEqual(["音楽"]);
            // Latin → CJK in auto mode: different scripts, separator optional
            expect(result.separatorMode).toBe("optional");
        });
    });

    describe("separatorMode - spacing=required", () => {
        const g = [
            `<Start> [spacing=required] = $(v:<Verb>) music -> true;`,
            `<Verb> [spacing=required] = play -> true;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("reports separatorMode when spacing=required", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.completions).toEqual(["music"]);
            expect(result.separatorMode).toBe("spacePunctuation");
        });
    });

    describe("separatorMode - spacing=optional", () => {
        const g = [
            `<Start> [spacing=optional] = $(v:<Verb>) music -> true;`,
            `<Verb> [spacing=optional] = play -> true;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("reports optional separatorMode when spacing=optional", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.completions).toEqual(["music"]);
            expect(result.separatorMode).toBe("optional");
        });
    });

    describe("separatorMode - wildcard entity", () => {
        // Grammar where the completion is a wildcard entity (not a static string).
        // separatorMode describes the boundary at matchedPrefixLength.
        const g = [
            `entity TrackName;`,
            `<Start> = play $(name:TrackName) -> { actionName: "play", parameters: { name } };`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("reports separatorMode for 'play' before wildcard", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.properties?.length).toBeGreaterThan(0);
            // matchedPrefixLength=4; boundary "y" → entity needs separator.
            expect(result.separatorMode).toBe("spacePunctuation");
        });

        it("reports separatorMode for 'play ' before wildcard", () => {
            // matchedPrefixLength=4 ("play"); the trailing space is
            // beyond that boundary.  separatorMode describes the
            // boundary at matchedPrefixLength: "y" → entity → "spacePunctuation".
            const result = matchGrammarCompletion(grammar, "play ");
            expect(result.properties?.length).toBeGreaterThan(0);
            expect(result.separatorMode).toBe("spacePunctuation");
        });
    });
});
