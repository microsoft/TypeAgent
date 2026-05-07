// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { traceMatch, loadGrammarFromBuffer } from "../src/index.js";
import type { TraceEvent } from "../src/index.js";

describe("traceMatch", () => {
    const source = `<Start> = play $(song:string) -> { action: "play", song };
<Start> = pause -> { action: "pause" };`;

    it("returns events for a matching input", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const trace = traceMatch(result.grammar, "play something");
        expect(trace.result).toBe("matched");
        expect(trace.input).toBe("play something");
        expect(trace.events.length).toBeGreaterThan(0);

        // Should have at least one ruleEntered and one partMatched
        const kinds = trace.events.map((e) => e.kind);
        expect(kinds).toContain("ruleEntered");
        expect(kinds).toContain("partMatched");
    });

    it("returns noMatch for non-matching input", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const trace = traceMatch(result.grammar, "xyz nothing");
        expect(trace.result).toBe("noMatch");
        expect(trace.events.length).toBeGreaterThan(0);

        // Should have partFailed events
        const kinds = trace.events.map((e) => e.kind);
        expect(kinds).toContain("partFailed");
    });

    it("seq values are monotonically increasing", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const trace = traceMatch(result.grammar, "pause");
        for (let i = 1; i < trace.events.length; i++) {
            expect(trace.events[i].seq).toBeGreaterThan(
                trace.events[i - 1].seq,
            );
        }
    });

    it("backtrack events fire for alternations", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // "pause" should try "play" first (rule 0), fail, backtrack, then try "pause"
        const trace = traceMatch(result.grammar, "pause");
        expect(trace.result).toBe("matched");

        const backtracks = trace.events.filter((e) => e.kind === "backtrack");
        expect(backtracks.length).toBeGreaterThan(0);
        expect(
            backtracks.some(
                (e) => e.kind === "backtrack" && e.origin === "alternation",
            ),
        ).toBe(true);
    });

    it("ruleEntered includes depth information", () => {
        const nested = `<Start> = do $(x:<Action>) -> x;
<Action> = play -> "play";
<Action> = stop -> "stop";`;
        const result = loadGrammarFromBuffer("test.agr", nested);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const trace = traceMatch(result.grammar, "do play");
        expect(trace.result).toBe("matched");

        const enters = trace.events.filter(
            (e): e is Extract<TraceEvent, { kind: "ruleEntered" }> =>
                e.kind === "ruleEntered",
        );
        // Should have both depth 0 (top-level) and depth > 0 (nested)
        expect(enters.some((e) => e.depth === 0)).toBe(true);
        expect(enters.some((e) => e.depth > 0)).toBe(true);
    });
});
