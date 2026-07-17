// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { captureRowTraces } from "../src/runtime/studioRuntimeCore.js";
import type { GrammarReplayResolver } from "../src/replay/grammarResolver.js";
import type {
    ActionDelta,
    ReplaySideTrace,
    VersionSpec,
} from "../src/replay/index.js";
import type { CorpusEntry } from "../src/corpus/index.js";

const versionA: VersionSpec = { kind: "workingTree" };
const versionB: VersionSpec = { kind: "git", ref: "HEAD" };

function entry(id: string): CorpusEntry {
    return {
        id,
        agent: "player",
        utterance: `utterance ${id}`,
        source: "in-repo",
    } as CorpusEntry;
}

function row(id: string, equal: boolean): ActionDelta {
    return {
        utterance: `utterance ${id}`,
        source: "in-repo",
        utteranceId: id,
        actionA: equal ? { a: 1 } : { a: 1 },
        actionB: equal ? { a: 1 } : { b: 2 },
        equal,
        cacheStateA: "miss",
        cacheStateB: "miss",
        collisionsA: [],
        collisionsB: [],
        latencyA: 0,
        latencyB: 0,
        requestIdA: `${id}-a`,
        requestIdB: `${id}-b`,
    } as ActionDelta;
}

/** A resolver that records how many times it traced and returns a trivial side
 *  trace, so the helper's ordering/mapping is what's under test — not the real
 *  grammar match. */
function fakeResolver(): {
    resolver: GrammarReplayResolver;
    traced: string[];
} {
    const traced: string[] = [];
    const resolver = {
        async resolveWithTrace(
            e: CorpusEntry,
            version: VersionSpec,
            side: "A" | "B",
        ) {
            traced.push(`${e.id}:${side}`);
            const sideTrace: ReplaySideTrace = {
                side,
                version,
                realization: "built-live",
                nodes: [],
                cacheState: "miss",
            } as ReplaySideTrace;
            return { resolution: {} as never, sideTrace };
        },
    } as unknown as GrammarReplayResolver;
    return { resolver, traced };
}

describe("captureRowTraces", () => {
    test("captures a trace for every row, changed rows first", async () => {
        const { resolver, traced } = fakeResolver();
        const rows = [row("u1", true), row("u2", false), row("u3", false)];
        const entries = [entry("u1"), entry("u2"), entry("u3")];

        const traces = await captureRowTraces(
            resolver,
            async () => entries,
            rows,
            "run-1",
            versionA,
            versionB,
        );

        // Changed rows (u2, u3) lead; the unchanged row (u1) is still captured.
        expect(traces.map((t) => t.utteranceId)).toEqual(["u2", "u3", "u1"]);
        expect(traces[0].runId).toBe("run-1");
        expect(traced).toEqual([
            "u2:A",
            "u2:B",
            "u3:A",
            "u3:B",
            "u1:A",
            "u1:B",
        ]);
    });

    test("does not list entries when there are no rows", async () => {
        const { resolver } = fakeResolver();
        let listed = 0;
        const traces = await captureRowTraces(
            resolver,
            async () => {
                listed += 1;
                return [];
            },
            [],
            "run-1",
            versionA,
            versionB,
        );
        expect(traces).toEqual([]);
        expect(listed).toBe(0);
    });

    test("skips a row whose corpus entry can't be found", async () => {
        const { resolver } = fakeResolver();
        const traces = await captureRowTraces(
            resolver,
            async () => [entry("u1")], // u2's entry is missing
            [row("u1", false), row("u2", false)],
            "run-1",
            versionA,
            versionB,
        );
        expect(traces.map((t) => t.utteranceId)).toEqual(["u1"]);
    });

    test("caps the number of captured traces at 100", async () => {
        const { resolver } = fakeResolver();
        const rows: ActionDelta[] = [];
        const entries: CorpusEntry[] = [];
        for (let i = 0; i < 150; i++) {
            rows.push(row(`u${i}`, false));
            entries.push(entry(`u${i}`));
        }
        const traces = await captureRowTraces(
            resolver,
            async () => entries,
            rows,
            "run-1",
            versionA,
            versionB,
        );
        expect(traces.length).toBe(100);
    });

    test("keeps every changed row when the cap is reached, dropping unchanged first", async () => {
        const { resolver } = fakeResolver();
        const rows: ActionDelta[] = [];
        const entries: CorpusEntry[] = [];
        // 50 unchanged rows listed before 60 changed rows: the cap of 100 must
        // still admit all 60 changed rows, filling the rest with unchanged.
        for (let i = 0; i < 50; i++) {
            rows.push(row(`e${i}`, true));
            entries.push(entry(`e${i}`));
        }
        for (let i = 0; i < 60; i++) {
            rows.push(row(`r${i}`, false));
            entries.push(entry(`r${i}`));
        }
        const traces = await captureRowTraces(
            resolver,
            async () => entries,
            rows,
            "run-1",
            versionA,
            versionB,
        );
        const captured = new Set(traces.map((t) => t.utteranceId));
        expect(traces.length).toBe(100);
        for (let i = 0; i < 60; i++) {
            expect(captured.has(`r${i}`)).toBe(true);
        }
    });
});
