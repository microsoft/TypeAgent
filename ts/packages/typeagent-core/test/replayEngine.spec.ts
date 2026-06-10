// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CorpusEntry, CorpusFilter } from "../src/corpus/types.js";
import { InProcessEventStream } from "../src/events/eventStream.js";
import type { StudioEvent } from "../src/events/types.js";
import {
    actionsEqual,
    replayCorpus,
    type ReplayActionResolver,
    type ReplayAgentResolution,
    type ReplayCorpusProvider,
    type ReplayOptions,
} from "../src/replay/index.js";

function entry(id: string, utterance: string): CorpusEntry {
    return {
        id,
        utterance,
        agent: "player",
        source: "in-repo",
        provenance: { sourceUri: `mem://${id}` },
    };
}

class FixedCorpus implements ReplayCorpusProvider {
    constructor(private readonly entries: CorpusEntry[]) {}
    async list(_agent: string, _filter: CorpusFilter): Promise<CorpusEntry[]> {
        return this.entries;
    }
}

/** Resolver driven by a per-utterance, per-side resolution table. */
class TableResolver implements ReplayActionResolver {
    constructor(
        private readonly table: Record<
            string,
            { A: ReplayAgentResolution; B: ReplayAgentResolution }
        >,
    ) {}
    resolve(
        e: CorpusEntry,
        _version: unknown,
        side: "A" | "B",
    ): ReplayAgentResolution {
        return this.table[e.id][side];
    }
}

const baseOptions: ReplayOptions = {
    agent: "player",
    corpus: {},
    versionA: { kind: "git", ref: "main" },
    versionB: { kind: "workingTree" },
    missPolicy: "needs-explanation",
};

async function collect(rows: AsyncIterable<unknown>): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const row of rows) {
        out.push(row);
    }
    return out;
}

describe("actionsEqual", () => {
    it("treats undefined as equal to undefined", () => {
        expect(actionsEqual(undefined, undefined)).toBe(true);
    });

    it("is key-order independent for objects", () => {
        expect(
            actionsEqual(
                { name: "play", count: 1 },
                { count: 1, name: "play" },
            ),
        ).toBe(true);
    });

    it("compares arrays positionally", () => {
        expect(actionsEqual([1, 2], [1, 2])).toBe(true);
        expect(actionsEqual([1, 2], [2, 1])).toBe(false);
    });

    it("detects nested differences", () => {
        expect(actionsEqual({ p: { q: 1 } }, { p: { q: 2 } })).toBe(false);
    });
});

describe("replayCorpus", () => {
    it("classifies equal, changed, new-match, and lost-match rows", async () => {
        const corpus = new FixedCorpus([
            entry("eq", "play jazz"),
            entry("ch", "skip"),
            entry("new", "pause"),
            entry("lost", "resume"),
        ]);
        const resolver = new TableResolver({
            eq: {
                A: { action: { a: 1 }, cacheState: "hit" },
                B: { action: { a: 1 }, cacheState: "hit" },
            },
            ch: {
                A: { action: { a: 1 }, cacheState: "hit" },
                B: { action: { a: 2 }, cacheState: "hit" },
            },
            new: {
                A: { cacheState: "needs-explanation" },
                B: { action: { a: 9 }, cacheState: "hit" },
            },
            lost: {
                A: { action: { a: 3 }, cacheState: "hit" },
                B: { cacheState: "needs-explanation" },
            },
        });

        const handle = replayCorpus(baseOptions, { corpus, resolver });
        const rows = await collect(handle.rows);
        const summary = await handle.summary;

        expect(rows.length).toBe(4);
        expect(summary.corpusSize).toBe(4);
        expect(summary.rowCount).toBe(4);
        expect(summary.equalCount).toBe(1);
        expect(summary.changedCount).toBe(1);
        expect(summary.newMatchCount).toBe(1);
        expect(summary.lostMatchCount).toBe(1);
    });

    it("omits strict-cache skipped rows but counts the corpus size", async () => {
        const corpus = new FixedCorpus([
            entry("ok", "play"),
            entry("skip", "weird"),
        ]);
        const resolver = new TableResolver({
            ok: {
                A: { action: { a: 1 }, cacheState: "hit" },
                B: { action: { a: 1 }, cacheState: "hit" },
            },
            skip: {
                A: { cacheState: "skipped" },
                B: { cacheState: "hit", action: { a: 2 } },
            },
        });

        const handle = replayCorpus(
            { ...baseOptions, missPolicy: "strict-cache" },
            { corpus, resolver },
        );
        const rows = await collect(handle.rows);
        const summary = await handle.summary;

        expect(rows.length).toBe(1);
        expect(summary.corpusSize).toBe(2);
        expect(summary.rowCount).toBe(1);
    });

    it("accumulates collision delta from B minus A", async () => {
        const collision = () => ({
            schemaVersion: 1 as const,
            type: "collision.detected" as const,
            ts: 0,
            sandboxId: "replay",
            kind: "overlap" as const,
            detectionPoint: "replay" as const,
            participants: [],
        });
        const corpus = new FixedCorpus([entry("c", "go")]);
        const resolver = new TableResolver({
            c: {
                A: {
                    action: { a: 1 },
                    cacheState: "hit",
                    collisions: [collision()],
                },
                B: {
                    action: { a: 1 },
                    cacheState: "hit",
                    collisions: [collision(), collision()],
                },
            },
        });

        const handle = replayCorpus(baseOptions, { corpus, resolver });
        await collect(handle.rows);
        const summary = await handle.summary;
        expect(summary.collisionDelta).toBe(1);
    });

    it("emits replay.row and replay.summary events with the run id", async () => {
        const emitter = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        emitter.subscribe((e) => captured.push(e));

        const corpus = new FixedCorpus([entry("eq", "play")]);
        const resolver = new TableResolver({
            eq: {
                A: { action: { a: 1 }, cacheState: "hit" },
                B: { action: { a: 1 }, cacheState: "hit" },
            },
        });

        const handle = replayCorpus(baseOptions, {
            corpus,
            resolver,
            emitter,
        });
        await collect(handle.rows);
        const summary = await handle.summary;

        const rowEvents = captured.filter((e) => e.type === "replay.row");
        const summaryEvents = captured.filter(
            (e) => e.type === "replay.summary",
        );
        expect(rowEvents.length).toBe(1);
        expect(summaryEvents.length).toBe(1);
        expect(rowEvents[0].runId).toBe(handle.runId);
        expect(summary.runId).toBe(handle.runId);
    });

    it("stops early when cancelled", async () => {
        const corpus = new FixedCorpus([
            entry("a", "1"),
            entry("b", "2"),
            entry("c", "3"),
        ]);
        let calls = 0;
        const resolver: ReplayActionResolver = {
            async resolve(): Promise<ReplayAgentResolution> {
                calls += 1;
                return { action: { a: calls }, cacheState: "hit" };
            },
        };
        const handle = replayCorpus(baseOptions, { corpus, resolver });
        await handle.cancel();
        const summary = await handle.summary;
        expect(summary.rowCount).toBe(0);
    });
});
