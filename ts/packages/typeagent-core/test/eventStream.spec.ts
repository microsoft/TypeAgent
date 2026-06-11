// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EVENT_SCHEMA_VERSION,
    InProcessEventStream,
    SUPPORTED_EVENT_TYPES,
    StudioEvent,
    eventMatchesFilter,
} from "../src/events/index.js";

function makePhaseStart(
    overrides: Partial<{
        ts: number;
        requestId: string;
        runId: string;
        sandboxId: string;
        agent: string;
        phase: string;
    }> = {},
): StudioEvent {
    return {
        schemaVersion: EVENT_SCHEMA_VERSION,
        type: "phase.start",
        ts: overrides.ts ?? 1000,
        sandboxId: overrides.sandboxId ?? "sandbox-a",
        phase: overrides.phase ?? "translate",
        ...(overrides.requestId !== undefined
            ? { requestId: overrides.requestId }
            : {}),
        ...(overrides.runId !== undefined ? { runId: overrides.runId } : {}),
        ...(overrides.agent !== undefined ? { agent: overrides.agent } : {}),
    };
}

function makeCacheHit(
    overrides: Partial<{ ts: number; agent: string }> = {},
): StudioEvent {
    return {
        schemaVersion: EVENT_SCHEMA_VERSION,
        type: "cache.hit",
        ts: overrides.ts ?? 2000,
        sandboxId: "sandbox-a",
        cacheKey: "k1",
        systemKind: "nfa",
        ...(overrides.agent !== undefined ? { agent: overrides.agent } : {}),
    };
}

describe("InProcessEventStream — basic delivery", () => {
    test("synchronous delivery to a single subscriber", () => {
        const s = new InProcessEventStream();
        const received: StudioEvent[] = [];
        s.subscribe((e) => received.push(e));
        const evt = makePhaseStart();
        s.emit(evt);
        expect(received).toEqual([evt]);
    });

    test("multiple subscribers each receive the same event", () => {
        const s = new InProcessEventStream();
        const a: StudioEvent[] = [];
        const b: StudioEvent[] = [];
        s.subscribe((e) => a.push(e));
        s.subscribe((e) => b.push(e));
        const evt = makeCacheHit();
        s.emit(evt);
        expect(a).toEqual([evt]);
        expect(b).toEqual([evt]);
    });

    test("unsubscribe stops further delivery and is idempotent", () => {
        const s = new InProcessEventStream();
        const received: StudioEvent[] = [];
        const sub = s.subscribe((e) => received.push(e));
        s.emit(makePhaseStart());
        sub.unsubscribe();
        sub.unsubscribe(); // idempotent
        s.emit(makePhaseStart({ ts: 2 }));
        expect(received).toHaveLength(1);
        expect(s.subscriptionCount()).toBe(0);
    });

    test("a throwing sink does not break other sinks", () => {
        const s = new InProcessEventStream();
        const received: StudioEvent[] = [];
        s.subscribe(() => {
            throw new Error("boom");
        });
        s.subscribe((e) => received.push(e));
        s.emit(makePhaseStart());
        expect(received).toHaveLength(1);
    });
});

describe("InProcessEventStream — filtering", () => {
    test("filter by type", () => {
        const s = new InProcessEventStream();
        const got: StudioEvent[] = [];
        s.subscribe((e) => got.push(e), { filter: { types: ["cache.hit"] } });
        s.emit(makePhaseStart());
        s.emit(makeCacheHit());
        expect(got.map((e) => e.type)).toEqual(["cache.hit"]);
    });

    test("filter by requestId only delivers events with a matching requestId", () => {
        const s = new InProcessEventStream();
        const got: StudioEvent[] = [];
        s.subscribe((e) => got.push(e), {
            filter: { requestIds: ["req-1"] },
        });
        s.emit(makePhaseStart({ requestId: "req-1" }));
        s.emit(makePhaseStart({ requestId: "req-2" }));
        s.emit(makePhaseStart()); // no requestId
        expect(got).toHaveLength(1);
        expect(got[0]?.requestId).toBe("req-1");
    });

    test("filter by agent, sandboxId, runId AND-combine", () => {
        const s = new InProcessEventStream();
        const got: StudioEvent[] = [];
        s.subscribe((e) => got.push(e), {
            filter: {
                agents: ["player"],
                sandboxIds: ["sandbox-a"],
                runIds: ["run-1"],
            },
        });
        s.emit(makePhaseStart({ agent: "player", runId: "run-1" })); // match
        s.emit(makePhaseStart({ agent: "code", runId: "run-1" })); // wrong agent
        s.emit(makePhaseStart({ agent: "player", runId: "run-2" })); // wrong run
        s.emit(makePhaseStart({ agent: "player" })); // missing runId
        expect(got).toHaveLength(1);
    });

    test("eventMatchesFilter helper returns true for empty/undefined filter", () => {
        const evt = makePhaseStart();
        expect(eventMatchesFilter(evt, undefined)).toBe(true);
        expect(eventMatchesFilter(evt, {})).toBe(true);
    });
});

describe("InProcessEventStream — query / ring buffer", () => {
    test("query yields buffered events in order", async () => {
        const s = new InProcessEventStream();
        s.emit(makePhaseStart({ ts: 1 }));
        s.emit(makePhaseStart({ ts: 2 }));
        s.emit(makePhaseStart({ ts: 3 }));
        const out: StudioEvent[] = [];
        for await (const e of s.query()) out.push(e);
        expect(out.map((e) => e.ts)).toEqual([1, 2, 3]);
    });

    test("query respects since/until", async () => {
        const s = new InProcessEventStream();
        for (const ts of [10, 20, 30, 40]) {
            s.emit(makePhaseStart({ ts }));
        }
        const out: StudioEvent[] = [];
        for await (const e of s.query({ since: 20, until: 30 })) out.push(e);
        expect(out.map((e) => e.ts)).toEqual([20, 30]);
    });

    test("query respects filter", async () => {
        const s = new InProcessEventStream();
        s.emit(makePhaseStart({ ts: 1, agent: "player" }));
        s.emit(makeCacheHit({ ts: 2, agent: "player" }));
        s.emit(makePhaseStart({ ts: 3, agent: "code" }));
        const out: StudioEvent[] = [];
        for await (const e of s.query({ filter: { agents: ["player"] } })) {
            out.push(e);
        }
        expect(out).toHaveLength(2);
    });

    test("ring buffer evicts oldest when capacity is exceeded", async () => {
        const s = new InProcessEventStream({ bufferCapacity: 3 });
        for (const ts of [1, 2, 3, 4, 5]) {
            s.emit(makePhaseStart({ ts }));
        }
        expect(s.bufferedCount()).toBe(3);
        const out: StudioEvent[] = [];
        for await (const e of s.query()) out.push(e);
        expect(out.map((e) => e.ts)).toEqual([3, 4, 5]);
    });
});

describe("InProcessEventStream — versions", () => {
    test("versions() returns the current schema version and all supported types", () => {
        const s = new InProcessEventStream();
        const v = s.versions();
        expect(v.schemaVersion).toBe(EVENT_SCHEMA_VERSION);
        expect(new Set(v.supportedEventTypes)).toEqual(
            new Set(SUPPORTED_EVENT_TYPES),
        );
    });
});

describe("InProcessEventStream — buffered (async) subscription", () => {
    test("buffered subscription delivers events on next microtask", async () => {
        const s = new InProcessEventStream();
        const got: StudioEvent[] = [];
        s.subscribe((e) => got.push(e), { bufferSize: 10 });
        s.emit(makePhaseStart({ ts: 1 }));
        // Not yet delivered.
        expect(got).toHaveLength(0);
        await Promise.resolve();
        expect(got).toHaveLength(1);
    });

    test("buffered subscription drops events when queue is full and reports count", async () => {
        const s = new InProcessEventStream();
        const got: StudioEvent[] = [];
        let droppedReported = 0;
        s.subscribe((e) => got.push(e), {
            bufferSize: 2,
            onDropped: (n) => {
                droppedReported += n;
            },
        });
        // Emit 5; only first 2 should be queued, 3 dropped.
        for (const ts of [1, 2, 3, 4, 5]) {
            s.emit(makePhaseStart({ ts }));
        }
        await Promise.resolve();
        await Promise.resolve();
        expect(got).toHaveLength(2);
        expect(got.map((e) => e.ts)).toEqual([1, 2]);
        expect(droppedReported).toBe(3);
    });

    test("rejects non-positive bufferSize", () => {
        const s = new InProcessEventStream();
        expect(() => s.subscribe(() => undefined, { bufferSize: 0 })).toThrow();
        expect(() =>
            s.subscribe(() => undefined, { bufferSize: -1 }),
        ).toThrow();
    });
});
