// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammarCompletion } from "../src/grammarMatcher.js";

describe("Grammar Completion - all alternatives after longest match", () => {
    // After the longest fully matched prefix, ALL valid next-part
    // completions are reported regardless of trailing partial text.
    // The caller is responsible for filtering by the trailing text.

    describe("alternatives preserved with partial trailing text", () => {
        const g = [
            `<Start> = $(a:<Verb>) $(b:<Object>) $(c:<Modifier>) -> { a, b, c };`,
            `<Verb> = play -> "play";`,
            `<Object> = rock -> "rock";`,
            `<Modifier> = music -> "music";`,
            `<Modifier> = hard -> "hard";`,
            `<Modifier> = loud -> "loud";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("without partial text: all alternatives are offered", () => {
            const result = matchGrammarCompletion(grammar, "play rock");
            expect(result.completions.sort()).toEqual([
                "hard",
                "loud",
                "music",
            ]);
            expect(result.matchedPrefixLength).toBe(9);
        });

        it("with trailing space: all alternatives are still offered", () => {
            const result = matchGrammarCompletion(grammar, "play rock ");
            expect(result.completions.sort()).toEqual([
                "hard",
                "loud",
                "music",
            ]);
        });

        it("partial text 'm': all alternatives still reported", () => {
            const result = matchGrammarCompletion(grammar, "play rock m");
            // All three are reported; caller filters by "m".
            expect(result.completions.sort()).toEqual([
                "hard",
                "loud",
                "music",
            ]);
            expect(result.matchedPrefixLength).toBe(9);
        });

        it("partial text 'h': all alternatives still reported", () => {
            const result = matchGrammarCompletion(grammar, "play rock h");
            expect(result.completions.sort()).toEqual([
                "hard",
                "loud",
                "music",
            ]);
            expect(result.matchedPrefixLength).toBe(9);
        });

        it("non-matching text 'x': all alternatives still reported", () => {
            const result = matchGrammarCompletion(grammar, "play rock x");
            // All alternatives are reported even though "x" doesn't
            // prefix-match any of them; the caller filters.
            expect(result.completions.sort()).toEqual([
                "hard",
                "loud",
                "music",
            ]);
            expect(result.matchedPrefixLength).toBe(9);
        });
    });

    describe("inline single-part alternatives preserved", () => {
        const g = [`<Start> = go (north | south | east | west) -> true;`].join(
            "\n",
        );
        const grammar = loadGrammarRules("test.grammar", g);

        it("all directions offered without partial text", () => {
            const result = matchGrammarCompletion(grammar, "go");
            expect(result.completions.sort()).toEqual([
                "east",
                "north",
                "south",
                "west",
            ]);
        });

        it("'n' trailing: all directions still offered", () => {
            const result = matchGrammarCompletion(grammar, "go n");
            expect(result.completions.sort()).toEqual([
                "east",
                "north",
                "south",
                "west",
            ]);
            expect(result.matchedPrefixLength).toBe(2);
        });

        it("'z' trailing: all directions still offered", () => {
            const result = matchGrammarCompletion(grammar, "go z");
            expect(result.completions.sort()).toEqual([
                "east",
                "north",
                "south",
                "west",
            ]);
            expect(result.matchedPrefixLength).toBe(2);
        });
    });

    describe("all alternatives after consumed prefix", () => {
        const g = [
            `<Start> = $(a:<A>) $(b:<B>) -> { a, b };`,
            `<A> = open -> "open";`,
            `<B> = file -> "file";`,
            `<B> = folder -> "folder";`,
            `<B> = finder -> "finder";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("'open f': all alternatives offered", () => {
            const result = matchGrammarCompletion(grammar, "open f");
            expect(result.completions.sort()).toEqual([
                "file",
                "finder",
                "folder",
            ]);
        });

        it("'open fi': all alternatives still offered", () => {
            const result = matchGrammarCompletion(grammar, "open fi");
            // "folder" is now correctly reported alongside file/finder.
            expect(result.completions.sort()).toEqual([
                "file",
                "finder",
                "folder",
            ]);
            expect(result.matchedPrefixLength).toBe(4);
        });
    });

    describe("no false completions when nothing consumed", () => {
        // When state.index === 0 (no prefix consumed), we should NOT
        // report unrelated string parts — only partial prefix matches.
        const g = [
            `<Start> = play $(g:<Genre>) -> { genre: g };`,
            `<Genre> = rock -> "rock";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("all first parts offered for unrelated input", () => {
            const result = matchGrammarCompletion(grammar, "xyz");
            // Nothing consumed; the first string part is offered
            // unconditionally.  The caller filters by trailing text.
            expect(result.completions).toEqual(["play"]);
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("partial prefix at start still works", () => {
            const result = matchGrammarCompletion(grammar, "pl");
            expect(result.completions).toContain("play");
        });
    });

    describe("separatorMode in Category 3b", () => {
        // Category 3b: finalizeState failed, trailing non-separator text
        // remains.  separatorMode indicates whether a separator is needed
        // between matchedPrefixLength and the completion text.

        describe("Latin grammar (auto spacing)", () => {
            const g = [
                `<Start> = $(a:<A>) $(b:<B>) -> { a, b };`,
                `<A> = play -> "a";`,
                `<B> = music -> "b";`,
                `<B> = midi -> "b2";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports separatorMode after consumed Latin prefix with trailing text", () => {
                // "play x" → consumed "play" (4 chars), trailing "x" fails.
                // Completion "music"/"midi" at matchedPrefixLength=4.
                // Last consumed char: "y" (Latin), first completion char: "m" (Latin)
                // → separator needed.
                const result = matchGrammarCompletion(grammar, "play x");
                expect(result.completions.sort()).toEqual(["midi", "music"]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("reports separatorMode with partial-match trailing text", () => {
                // "play mu" → consumed "play" (4 chars), trailing "mu".
                // Same boundary: "y" → "m" → separator needed.
                const result = matchGrammarCompletion(grammar, "play mu");
                expect(result.completions.sort()).toEqual(["midi", "music"]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.separatorMode).toBe("spacePunctuation");
            });
        });

        describe("CJK grammar (auto spacing)", () => {
            const g = [
                `<Start> [spacing=auto] = $(a:<A>) $(b:<B>) -> { a, b };`,
                `<A> [spacing=auto] = 再生 -> "a";`,
                `<B> [spacing=auto] = 音楽 -> "b";`,
                `<B> [spacing=auto] = 映画 -> "b2";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports optional separatorMode for CJK → CJK", () => {
                // "再生x" → consumed "再生" (2 chars), trailing "x" fails.
                // Last consumed char: "生" (CJK), first completion: "音" (CJK)
                // → separator optional in auto mode.
                const result = matchGrammarCompletion(grammar, "再生x");
                expect(result.completions.sort()).toEqual(["映画", "音楽"]);
                expect(result.matchedPrefixLength).toBe(2);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("nothing consumed (index=0)", () => {
            const g = [
                `<Start> = play $(g:<Genre>) -> { genre: g };`,
                `<Genre> = rock -> "rock";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports optional separatorMode when nothing consumed", () => {
                // "xyz" → consumed 0 chars, offers "play" at prefixLength=0.
                // No last consumed char → no separator check.
                const result = matchGrammarCompletion(grammar, "xyz");
                expect(result.completions).toEqual(["play"]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("spacing=required", () => {
            const g = [
                `<Start> [spacing=required] = $(a:<A>) $(b:<B>) -> { a, b };`,
                `<A> [spacing=required] = play -> "a";`,
                `<B> [spacing=required] = music -> "b";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports separatorMode for spacing=required with trailing text", () => {
                const result = matchGrammarCompletion(grammar, "play x");
                expect(result.completions).toEqual(["music"]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.separatorMode).toBe("spacePunctuation");
            });
        });

        describe("spacing=optional", () => {
            const g = [
                `<Start> [spacing=optional] = $(a:<A>) $(b:<B>) -> { a, b };`,
                `<A> [spacing=optional] = play -> "a";`,
                `<B> [spacing=optional] = music -> "b";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports optional separatorMode for spacing=optional", () => {
                const result = matchGrammarCompletion(grammar, "play x");
                expect(result.completions).toEqual(["music"]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("mixed scripts (Latin → CJK)", () => {
            const g = [
                `<Start> [spacing=auto] = $(a:<A>) $(b:<B>) -> { a, b };`,
                `<A> [spacing=auto] = play -> "a";`,
                `<B> [spacing=auto] = 音楽 -> "b";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports optional separatorMode for Latin → CJK", () => {
                // Last consumed: "y" (Latin), completion: "音" (CJK)
                // → different scripts, separator optional in auto mode.
                const result = matchGrammarCompletion(grammar, "play x");
                expect(result.completions).toEqual(["音楽"]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.separatorMode).toBe("optional");
            });
        });
    });
});
