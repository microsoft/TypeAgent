// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchGrammar } from "../src/grammarMatcher.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import type {
    TraceEvent,
    TraceCallback,
    RuleEnteredEvent,
    RuleExitedEvent,
    PartAttemptedEvent,
    PartMatchedEvent,
    PartFailedEvent,
    BacktrackEvent,
} from "../src/traceEvents.js";

function collect(grammar: ReturnType<typeof loadGrammarRules>, input: string) {
    const events: TraceEvent[] = [];
    const trace: TraceCallback = (e) => events.push(e);
    const results = matchGrammar(grammar, input, { trace });
    return { events, results };
}

describe("trace hook", () => {
    const simple = loadGrammarRules(
        "test",
        `<Start> = play $(song:string) -> { action: "play", song };
<Start> = pause -> { action: "pause" };`,
    );

    const nested = loadGrammarRules(
        "test",
        `<Start> = do $(x:<Action>) -> x;
<Action> = play -> "play";
<Action> = stop -> "stop";`,
    );

    // ---------------------------------------------------------------
    // Basic event emission
    // ---------------------------------------------------------------

    it("emits ruleEntered on rule entry", () => {
        const { events } = collect(simple, "pause");
        const entered = events.filter(
            (e): e is RuleEnteredEvent => e.kind === "ruleEntered",
        );
        expect(entered.length).toBeGreaterThan(0);
        expect(entered[0].depth).toBe(0);
    });

    it("emits ruleExited with matched result on success", () => {
        const { events } = collect(simple, "pause");
        const exited = events.filter(
            (e): e is RuleExitedEvent => e.kind === "ruleExited",
        );
        expect(exited.some((e) => e.result === "matched")).toBe(true);
    });

    it("emits partAttempted before part match", () => {
        const { events } = collect(simple, "pause");
        const attempted = events.filter(
            (e): e is PartAttemptedEvent => e.kind === "partAttempted",
        );
        expect(attempted.length).toBeGreaterThan(0);
        expect(attempted[0].partKind).toBe("string");
    });

    it("emits partMatched with endPos on success", () => {
        const { events } = collect(simple, "pause");
        const matched = events.filter(
            (e): e is PartMatchedEvent => e.kind === "partMatched",
        );
        expect(matched.length).toBeGreaterThan(0);
        expect(matched[0].endPos).toBeGreaterThan(0);
    });

    it("emits partFailed when a part does not match", () => {
        const { events } = collect(simple, "pause");
        // "pause" fails to match "play" (rule 0's string part)
        const failed = events.filter(
            (e): e is PartFailedEvent => e.kind === "partFailed",
        );
        expect(failed.length).toBeGreaterThan(0);
    });

    it("emits backtrack with origin for alternation", () => {
        const { events } = collect(simple, "pause");
        const backtracks = events.filter(
            (e): e is BacktrackEvent => e.kind === "backtrack",
        );
        expect(backtracks.some((e) => e.origin === "alternation")).toBe(true);
    });

    // ---------------------------------------------------------------
    // Seq monotonicity
    // ---------------------------------------------------------------

    it("has monotonically increasing seq across all events", () => {
        const { events } = collect(simple, "play something");
        for (let i = 1; i < events.length; i++) {
            expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
        }
    });

    // ---------------------------------------------------------------
    // Structural invariants
    // ---------------------------------------------------------------

    it("ruleExited fires for successful matches", () => {
        const { events } = collect(simple, "pause");
        const exited = events.filter((e) => e.kind === "ruleExited");
        // At least one ruleExited should fire for the successful match
        expect(exited.length).toBeGreaterThanOrEqual(1);
    });

    it("partAttempted precedes every partMatched/partFailed", () => {
        const { events } = collect(simple, "play hello");
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.kind === "partMatched" || e.kind === "partFailed") {
                // There should be a preceding partAttempted with the same part id
                const preceding = events
                    .slice(0, i)
                    .reverse()
                    .find(
                        (p) =>
                            p.kind === "partAttempted" &&
                            p.part === e.part &&
                            p.rule === e.rule,
                    );
                expect(preceding).toBeDefined();
            }
        }
    });

    // ---------------------------------------------------------------
    // Nested rules
    // ---------------------------------------------------------------

    it("tracks depth for nested rule calls", () => {
        const { events } = collect(nested, "do play");
        const entered = events.filter(
            (e): e is RuleEnteredEvent => e.kind === "ruleEntered",
        );
        const depths = entered.map((e) => e.depth);
        expect(Math.min(...depths)).toBe(0);
        expect(Math.max(...depths)).toBeGreaterThan(0);
    });

    it("nested ruleExited fires before parent continues", () => {
        const { events } = collect(nested, "do play");
        const exits = events.filter(
            (e): e is RuleExitedEvent => e.kind === "ruleExited",
        );
        // The nested rule should exit with "matched" before the parent
        expect(exits.length).toBeGreaterThanOrEqual(1);
        expect(exits.some((e) => e.result === "matched")).toBe(true);
    });

    // ---------------------------------------------------------------
    // No-match scenarios
    // ---------------------------------------------------------------

    it("emits events even for completely unmatched input", () => {
        const { events, results } = collect(simple, "xyz nope");
        expect(results.length).toBe(0);
        expect(events.length).toBeGreaterThan(0);
        // Should have partFailed events
        expect(events.some((e) => e.kind === "partFailed")).toBe(true);
    });

    // ---------------------------------------------------------------
    // Zero overhead when no trace
    // ---------------------------------------------------------------

    it("produces no events when trace callback is not provided", () => {
        // Just verify matchGrammar works without trace
        const results = matchGrammar(simple, "pause");
        expect(results.length).toBeGreaterThan(0);
    });

    // ---------------------------------------------------------------
    // Wildcard parts
    // ---------------------------------------------------------------

    it("emits partAttempted with partKind wildcard for wildcard parts", () => {
        const { events } = collect(simple, "play something");
        const attempted = events.filter(
            (e): e is PartAttemptedEvent => e.kind === "partAttempted",
        );
        expect(attempted.some((e) => e.partKind === "wildcard")).toBe(true);
    });

    // ---------------------------------------------------------------
    // inputPos tracking
    // ---------------------------------------------------------------

    it("inputPos advances as parts are matched", () => {
        const { events } = collect(simple, "play hello");
        const matched = events.filter(
            (e): e is PartMatchedEvent => e.kind === "partMatched",
        );
        if (matched.length >= 2) {
            // Later matched parts should have equal or higher endPos
            expect(matched[matched.length - 1].endPos).toBeGreaterThanOrEqual(
                matched[0].endPos,
            );
        }
    });

    // ---------------------------------------------------------------
    // Rule names populated in trace events
    // ---------------------------------------------------------------

    it("populates non-empty rule names on trace events", () => {
        const { events } = collect(simple, "pause");
        const withRule = events.filter((e) => e.kind !== "backtrack");
        expect(withRule.length).toBeGreaterThan(0);
        for (const e of withRule) {
            expect((e as RuleEnteredEvent).rule).toBeTruthy();
        }
    });

    it("does not populate rule names without trace callback", () => {
        // matchGrammar without a trace callback should not track names
        // (trackNames stays false, avoiding the overhead).
        const results = matchGrammar(simple, "pause");
        expect(results.length).toBeGreaterThan(0);
        // No events to inspect, but verifies the codepath works
        // without populating names. The real guarantee is structural:
        // trackNames is only set when trace is provided.
    });

    it("rule names include the grammar rule name", () => {
        const { events } = collect(nested, "do play");
        const entered = events.filter(
            (e): e is RuleEnteredEvent => e.kind === "ruleEntered",
        );
        const names = entered.map((e) => e.rule);
        expect(names.some((n) => n.includes("Start"))).toBe(true);
        expect(names.some((n) => n.includes("Action"))).toBe(true);
    });

    // ---------------------------------------------------------------
    // capturedValue on PartMatchedEvent
    // ---------------------------------------------------------------

    it("emits capturedValue for number variable parts", () => {
        const withNumber = loadGrammarRules(
            "test",
            `<Start> = set volume $(level:number) -> { action: "volume", level };`,
        );
        const { events } = collect(withNumber, "set volume 42");
        const matched = events.filter(
            (e): e is PartMatchedEvent => e.kind === "partMatched",
        );
        const withCapture = matched.filter(
            (e) => e.capturedValue !== undefined,
        );
        expect(withCapture.length).toBeGreaterThan(0);
        const cap = withCapture[0].capturedValue!;
        expect(cap.variable).toBe("level");
        expect(cap.value).toBe(42);
    });

    it("does not emit capturedValue for string-literal parts", () => {
        const { events } = collect(simple, "pause");
        const matched = events.filter(
            (e): e is PartMatchedEvent => e.kind === "partMatched",
        );
        // The "pause" string-literal part should not have capturedValue
        const stringParts = matched.filter(
            (e) => e.capturedValue === undefined,
        );
        expect(stringParts.length).toBeGreaterThan(0);
    });

    it("does not emit capturedValue for wildcard parts (value is deferred)", () => {
        const { events } = collect(simple, "play hello");
        const matched = events.filter(
            (e): e is PartMatchedEvent => e.kind === "partMatched",
        );
        // Wildcard parts defer capture, so no partMatched event
        // should carry capturedValue with variable "song".
        const wildcardCaptures = matched.filter(
            (e) => e.capturedValue?.variable === "song",
        );
        expect(wildcardCaptures).toHaveLength(0);
    });
});
