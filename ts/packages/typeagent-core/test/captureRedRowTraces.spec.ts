// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { captureRedRowTraces } from "../src/runtime/studioRuntimeCore.js";
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
 *  trace, so the helper's filtering/mapping is what's under test — not the real
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

describe("captureRedRowTraces", () => {
    test("captures a trace only for changed (red) rows", async () => {
        const { resolver, traced } = fakeResolver();
        const rows = [row("u1", true), row("u2", false), row("u3", false)];
        const entries = [entry("u1"), entry("u2"), entry("u3")];

        const traces = await captureRedRowTraces(
            resolver,
            async () => entries,
            rows,
            "run-1",
            versionA,
            versionB,
        );

        expect(traces.map((t) => t.utteranceId)).toEqual(["u2", "u3"]);
        expect(traces[0].runId).toBe("run-1");
        // Both sides traced for each red row; the green row is never traced.
        expect(traced).toEqual(["u2:A", "u2:B", "u3:A", "u3:B"]);
    });

    test("does not list entries when there are no red rows", async () => {
        const { resolver } = fakeResolver();
        let listed = 0;
        const traces = await captureRedRowTraces(
            resolver,
            async () => {
                listed += 1;
                return [];
            },
            [row("u1", true)],
            "run-1",
            versionA,
            versionB,
        );
        expect(traces).toEqual([]);
        expect(listed).toBe(0);
    });

    test("skips a red row whose corpus entry can't be found", async () => {
        const { resolver } = fakeResolver();
        const traces = await captureRedRowTraces(
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
        const traces = await captureRedRowTraces(
            resolver,
            async () => entries,
            rows,
            "run-1",
            versionA,
            versionB,
        );
        expect(traces.length).toBe(100);
    });
});
