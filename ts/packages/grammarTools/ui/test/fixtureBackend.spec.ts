// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FixtureBackend } from "../src/fixture/fixtureBackend.js";

describe("FixtureBackend", () => {
    let backend: FixtureBackend;

    beforeEach(() => {
        backend = new FixtureBackend({ delayMs: 0 });
    });

    describe("loadGrammarFromFile", () => {
        it("returns a successful LoadResult", async () => {
            const result = await backend.loadGrammarFromFile("anything.agr");
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.grammar).toBeDefined();
            expect(result.grammar.source.kind).toBe("buffer");
            expect(result.grammar.identifiers.ruleIds.length).toBeGreaterThan(
                0,
            );
        });

        it("includes debugInfo with rules map", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.grammar.debugInfo).toBeDefined();
            expect(result.grammar.debugInfo!.rules.size).toBeGreaterThan(0);
            expect(result.grammar.debugInfo!.grammarHash).toBeTruthy();
        });

        it("includes source files", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.grammar.files).toBeDefined();
            expect(result.grammar.files!.length).toBe(1);
            expect(result.grammar.files![0].text.length).toBeGreaterThan(0);
        });
    });

    describe("loadGrammarFromBuffer", () => {
        it("returns a successful LoadResult", async () => {
            const result = await backend.loadGrammarFromBuffer(
                "test",
                "<X> = hello;",
            );
            expect(result.ok).toBe(true);
        });
    });

    describe("loadGrammarFromAgent", () => {
        it("returns a successful LoadResult", async () => {
            const result = await backend.loadGrammarFromAgent("player");
            expect(result.ok).toBe(true);
        });
    });

    describe("loadGrammarFromSnapshot", () => {
        it("returns a successful LoadResult", async () => {
            const result = await backend.loadGrammarFromSnapshot({
                grammar: {},
            });
            expect(result.ok).toBe(true);
        });
    });

    describe("previewCompletion", () => {
        it("returns completions for empty input", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const preview = await backend.previewCompletion(result.grammar, "");
            expect(preview.groups.length).toBeGreaterThan(0);
            expect(preview.matchedPrefixLength).toBe(0);
            expect(preview.afterWildcard).toBe("none");
        });

        it("returns play-specific completions for 'play' input", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const preview = await backend.previewCompletion(
                result.grammar,
                "play",
            );
            expect(preview.matchedPrefixLength).toBe(5);
            expect(preview.afterWildcard).toBe("some");
            expect(preview.groups[0].completions).toContain("by");
        });

        it("returns beat-related completions for input with 'beat'", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const preview = await backend.previewCompletion(
                result.grammar,
                "play songs by the beat",
            );
            expect(preview.matchedPrefixLength).toBe(14);
            const allCompletions = preview.groups.flatMap((g) => g.completions);
            expect(allCompletions).toContain("beatles");
        });

        it("has separatorMode on every group", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const preview = await backend.previewCompletion(result.grammar, "");
            for (const group of preview.groups) {
                expect(group.separatorMode).toBeDefined();
                expect(typeof group.separatorMode).toBe("string");
            }
        });
    });

    describe("traceMatch", () => {
        it("returns a MatchTrace with events", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const trace = await backend.traceMatch(
                result.grammar,
                "play songs by the beatles",
            );
            expect(trace.input).toBe("play songs by the beatles");
            expect(trace.events.length).toBeGreaterThan(0);
            expect(trace.result).toBe("matched");
        });

        it("events have required fields", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const trace = await backend.traceMatch(result.grammar, "test");
            for (const event of trace.events) {
                expect(event.kind).toBeDefined();
                expect(
                    typeof (event as unknown as Record<string, unknown>).rule,
                ).toBe("string");
            }
        });
    });

    describe("computeCoverage", () => {
        it("returns a CoverageReport with totals", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const report = await backend.computeCoverage(result.grammar, [
                "play something",
            ]);
            expect(report.totals.rules).toBeGreaterThan(0);
            expect(report.totals.parts).toBeGreaterThan(0);
            expect(report.perRule.length).toBeGreaterThan(0);
            expect(report.grammarHash).toBeTruthy();
        });

        it("includes unmatched inputs", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const report = await backend.computeCoverage(result.grammar, []);
            expect(report.unmatchedInputs).toBeInstanceOf(Array);
            expect(report.unmatchedInputs.length).toBeGreaterThan(0);
        });

        it("perRule entries have parts arrays", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const report = await backend.computeCoverage(result.grammar, []);
            for (const rule of report.perRule) {
                expect(rule.id).toBeTruthy();
                expect(rule.parts).toBeInstanceOf(Array);
                expect(typeof rule.hits).toBe("number");
            }
        });
    });

    describe("diffGrammars", () => {
        it("returns a GrammarDiff with added/removed/changed", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const diff = await backend.diffGrammars(
                result.grammar,
                result.grammar,
            );
            expect(diff.added).toBeInstanceOf(Array);
            expect(diff.removed).toBeInstanceOf(Array);
            expect(diff.changed).toBeInstanceOf(Array);
        });

        it("changed entries have before/after text", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const diff = await backend.diffGrammars(
                result.grammar,
                result.grammar,
            );
            for (const change of diff.changed) {
                expect(change.rule).toBeTruthy();
                expect(change.reason).toBeTruthy();
                expect(typeof change.before).toBe("string");
                expect(typeof change.after).toBe("string");
            }
        });
    });

    describe("format", () => {
        it("returns formatted grammar text", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");

            const text = await backend.format(result.grammar);
            expect(typeof text).toBe("string");
            expect(text.length).toBeGreaterThan(0);
        });
    });

    describe("listAgents", () => {
        it("returns an array of agent names", async () => {
            const agents = await backend.listAgents();
            expect(agents).toBeInstanceOf(Array);
            expect(agents.length).toBeGreaterThan(0);
            expect(agents).toContain("player");
        });
    });

    describe("delay behavior", () => {
        it("respects delayMs option", async () => {
            const slowBackend = new FixtureBackend({ delayMs: 50 });
            const start = Date.now();
            await slowBackend.loadGrammarFromFile("test.agr");
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing variance
        });

        it("no delay when delayMs is 0", async () => {
            const start = Date.now();
            await backend.loadGrammarFromFile("test.agr");
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(20);
        });
    });
});
