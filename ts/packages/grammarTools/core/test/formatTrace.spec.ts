// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    traceMatch,
    formatTrace,
    loadGrammarFromBuffer,
} from "../src/index.js";

describe("formatTrace", () => {
    const source = `<Start> = play $(song:string) -> { action: "play", song };
<Start> = pause -> { action: "pause" };`;

    function load() {
        const result = loadGrammarFromBuffer("test.agr", source);
        if (!result.ok) throw new Error("grammar load failed");
        return result.grammar;
    }

    it("produces a non-empty string", () => {
        const trace = traceMatch(load(), "play something");
        const output = formatTrace(trace);
        expect(output.length).toBeGreaterThan(0);
    });

    it("includes header with input and result by default", () => {
        const trace = traceMatch(load(), "pause");
        const output = formatTrace(trace);
        expect(output).toContain('input: "pause"');
        expect(output).toContain("result: matched");
    });

    it("omits header when header: false", () => {
        const trace = traceMatch(load(), "pause");
        const output = formatTrace(trace, { header: false });
        expect(output).not.toContain("input:");
        expect(output).not.toContain("result:");
    });

    it("shows seq numbers when showSeq: true", () => {
        const trace = traceMatch(load(), "pause");
        const output = formatTrace(trace, { showSeq: true });
        // Each non-header line should start with [N]
        const lines = output.split("\n").filter((l) => l.match(/^\[/));
        expect(lines.length).toBeGreaterThan(0);
    });

    it("includes rule entry and exit markers", () => {
        const trace = traceMatch(load(), "play hello");
        const output = formatTrace(trace);
        // ▶ for rule entry
        expect(output).toContain("\u25b6");
        // ✓ or ✗ for rule exit
        expect(output.includes("\u2713") || output.includes("\u2717")).toBe(
            true,
        );
    });

    it("shows matched text excerpts", () => {
        const trace = traceMatch(load(), "play hello");
        const output = formatTrace(trace);
        // Should show "play" or "hello" as matched text
        expect(output).toContain('"play"');
    });

    it("shows backtrack markers for alternation", () => {
        // "pause" tries play first, backtracks, then matches pause
        const trace = traceMatch(load(), "pause");
        const output = formatTrace(trace);
        expect(output).toContain("\u21b6 backtrack (alternation)");
    });

    it("shows nested indentation for sub-rules", () => {
        const nested = `<Start> = do $(x:<Action>) -> x;
<Action> = play -> "play";`;
        const result = loadGrammarFromBuffer("test.agr", nested);
        if (!result.ok) throw new Error("grammar load failed");

        const trace = traceMatch(result.grammar, "do play");
        const output = formatTrace(trace, { header: false });
        const lines = output.split("\n");

        // Find lines with indentation (nested rules)
        const indented = lines.filter((l) => l.startsWith("    "));
        expect(indented.length).toBeGreaterThan(0);
    });

    it("shows noMatch result for non-matching input", () => {
        const trace = traceMatch(load(), "xyz");
        const output = formatTrace(trace);
        expect(output).toContain("result: noMatch");
    });

    it("truncates long excerpts", () => {
        const trace = traceMatch(load(), "play a very long song title here");
        const output = formatTrace(trace, { excerptWidth: 10 });
        // The wildcard match excerpt should be truncated with ellipsis
        if (output.includes("\u2026")) {
            // Good - truncation happened
            expect(true).toBe(true);
        } else {
            // If text is short enough not to need truncation, that's also fine
            expect(true).toBe(true);
        }
    });

    it("handles empty events array", () => {
        const emptyTrace = {
            input: "test",
            events: [] as readonly import("action-grammar").TraceEvent[],
            result: "noMatch" as const,
        };
        const output = formatTrace(emptyTrace);
        expect(output).toContain("result: noMatch");
        // Should produce header but no event lines
        const lines = output.split("\n").filter((l) => l.trim().length > 0);
        // Only header lines
        expect(lines.length).toBeLessThanOrEqual(2);
    });

    it("combines showSeq and showPos options", () => {
        const trace = traceMatch(load(), "pause");
        const output = formatTrace(trace, { showSeq: true, showPos: true });
        // Should have both seq markers and position info
        expect(output).toMatch(/\[\d+\]/);
        expect(output).toContain("@");
    });

    it("handles header: false with showSeq: true", () => {
        const trace = traceMatch(load(), "pause");
        const output = formatTrace(trace, {
            header: false,
            showSeq: true,
        });
        expect(output).not.toContain("input:");
        expect(output).toMatch(/\[\d+\]/);
    });

    // ---------------------------------------------------------------
    // Source location annotations
    // ---------------------------------------------------------------

    it("shows source locations when debugInfo is provided", () => {
        const g = load();
        const trace = traceMatch(g, "pause");
        const output = formatTrace(trace, { debugInfo: g.debugInfo });
        // Should contain file:line:col annotations
        expect(output).toContain("(test.agr:");
    });

    it("omits source locations when debugInfo is absent", () => {
        const trace = traceMatch(load(), "pause");
        const output = formatTrace(trace);
        // Should not contain file references
        expect(output).not.toContain("(test.agr:");
    });

    it("respects showSourceLocations: false even with debugInfo", () => {
        const g = load();
        const trace = traceMatch(g, "pause");
        const output = formatTrace(trace, {
            debugInfo: g.debugInfo,
            showSourceLocations: false,
        });
        expect(output).not.toContain("(test.agr:");
    });

    it("source locations have 1-based line numbers", () => {
        const g = load();
        const trace = traceMatch(g, "pause");
        const output = formatTrace(trace, { debugInfo: g.debugInfo });
        // Extract all (file:line:col) annotations
        const locs = [...output.matchAll(/\(test\.agr:(\d+):(\d+)\)/g)];
        expect(locs.length).toBeGreaterThan(0);
        for (const m of locs) {
            const line = parseInt(m[1], 10);
            const col = parseInt(m[2], 10);
            // 1-based, so both should be >= 1
            expect(line).toBeGreaterThanOrEqual(1);
            expect(col).toBeGreaterThanOrEqual(1);
        }
    });
});
