// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type {
    CommandResult,
    Dispatcher,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
import {
    QueueFullError,
    ServerStoppingError,
} from "@typeagent/dispatcher-types";

import {
    RequestQueue,
    MAX_QUEUE_DEPTH,
    QueueBroadcaster,
} from "../src/requestQueue.js";

type RecordedEvent =
    | { type: "queued"; entry: QueuedRequest; version: number }
    | { type: "started"; entry: QueuedRequest; version: number }
    | {
          type: "cancelled";
          requestId: string;
          reason: QueueCancelReason;
          version: number;
      }
    | { type: "snapshot"; snapshot: QueueSnapshot };

function makeRecorder(): {
    events: RecordedEvent[];
    broadcaster: QueueBroadcaster;
} {
    const events: RecordedEvent[] = [];
    const broadcaster: QueueBroadcaster = {
        requestQueued(entry, version) {
            events.push({ type: "queued", entry, version });
        },
        requestStarted(entry, version) {
            events.push({ type: "started", entry, version });
        },
        requestCancelled(requestId, reason, version) {
            events.push({ type: "cancelled", requestId, reason, version });
        },
        queueStateChanged(snapshot) {
            events.push({
                type: "snapshot",
                snapshot: {
                    ...snapshot,
                    queued: snapshot.queued.map((e) => ({ ...e })),
                },
            });
        },
    };
    return { events, broadcaster };
}

/**
 * Mock dispatcher that lets the test resolve / reject each
 * processCommand call on demand.
 */
class ControllableDispatcher implements Pick<Dispatcher, "processCommand"> {
    public calls: Array<{
        command: string;
        clientRequestId: unknown;
        requestId: string | undefined;
        resolve: (r: CommandResult | undefined) => void;
        reject: (e: unknown) => void;
        promise: Promise<CommandResult | undefined>;
    }> = [];

    processCommand = (
        command: string,
        clientRequestId?: unknown,
        _attachments?: string[],
        _options?: any,
        requestId?: string,
    ): Promise<CommandResult | undefined> => {
        let resolve!: (r: CommandResult | undefined) => void;
        let reject!: (e: unknown) => void;
        const promise = new Promise<CommandResult | undefined>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        this.calls.push({
            command,
            clientRequestId,
            requestId,
            resolve,
            reject,
            promise,
        });
        return promise;
    };
}

function makeQueue(dispatcher: ControllableDispatcher) {
    const { events, broadcaster } = makeRecorder();
    const queue = new RequestQueue(
        (ctx) =>
            dispatcher.processCommand(
                ctx.text,
                ctx.clientRequestId,
                ctx.attachments,
                ctx.options,
                ctx.requestId,
            ),
        broadcaster,
    );
    return { queue, events };
}

const flush = async () => {
    // Allow microtasks scheduled by the drain loop to run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

describe("RequestQueue", () => {
    it("submits and drains a single entry in FIFO order", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue, events } = makeQueue(dispatcher);

        const entry = queue.submit({
            text: "hello",
            originatorConnectionId: "c1",
        });

        await flush();
        expect(dispatcher.calls.length).toBe(1);
        expect(dispatcher.calls[0].command).toBe("hello");
        expect(dispatcher.calls[0].requestId).toBe(entry.requestId);

        dispatcher.calls[0].resolve({});
        await entry.completion;

        const types = events.map((e) => e.type);
        // queued + snapshot, then started + snapshot, then final snapshot
        expect(types).toEqual([
            "queued",
            "snapshot",
            "started",
            "snapshot",
            "snapshot",
        ]);

        const finalSnap = (events[events.length - 1] as any).snapshot;
        expect(finalSnap.running).toBeNull();
        expect(finalSnap.queued).toEqual([]);
    });

    it("dispatches submits in FIFO order", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        const b = queue.submit({ text: "b", originatorConnectionId: "c1" });
        const c = queue.submit({ text: "c", originatorConnectionId: "c1" });

        await flush();
        expect(dispatcher.calls.length).toBe(1);
        expect(dispatcher.calls[0].command).toBe("a");

        dispatcher.calls[0].resolve({});
        await a.completion;
        await flush();
        expect(dispatcher.calls.length).toBe(2);
        expect(dispatcher.calls[1].command).toBe("b");

        dispatcher.calls[1].resolve({});
        await b.completion;
        await flush();
        expect(dispatcher.calls.length).toBe(3);
        expect(dispatcher.calls[2].command).toBe("c");

        dispatcher.calls[2].resolve({});
        await c.completion;
    });

    it("cancelQueued removes the entry and broadcasts requestCancelled", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue, events } = makeQueue(dispatcher);

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        const b = queue.submit({ text: "b", originatorConnectionId: "c1" });

        await flush();
        // a is running; b is queued.
        expect(queue.getSnapshot().queued.map((e) => e.text)).toEqual(["b"]);

        const removed = queue.cancelQueued(b.requestId, "user");
        expect(removed).toBe(true);

        const cancelEvent = events.find(
            (e) => e.type === "cancelled" && e.requestId === b.requestId,
        );
        expect(cancelEvent).toBeDefined();

        const snap = queue.getSnapshot();
        expect(snap.queued).toEqual([]);
        expect(snap.running?.text).toBe("a");

        // b's completion promise should resolve with cancelled: true
        const bResult = await b.completion;
        expect(bResult?.cancelled).toBe(true);

        dispatcher.calls[0].resolve({});
        await a.completion;
    });

    it("cancelQueued returns false for unknown id", () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);
        expect(queue.cancelQueued("does-not-exist", "user")).toBe(false);
    });

    it("running entry rejection continues the drain loop", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        const b = queue.submit({ text: "b", originatorConnectionId: "c1" });

        await flush();
        dispatcher.calls[0].reject(new Error("boom"));

        await expect(a.completion).rejects.toThrow("boom");
        await flush();

        expect(dispatcher.calls.length).toBe(2);
        expect(dispatcher.calls[1].command).toBe("b");
        dispatcher.calls[1].resolve({});
        await b.completion;
    });

    it("snapshot reflects current state", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);
        expect(queue.getSnapshot()).toEqual({
            running: null,
            queued: [],
            paused: false,
            version: 0,
        });

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        queue.submit({ text: "b", originatorConnectionId: "c1" });
        queue.submit({ text: "c", originatorConnectionId: "c1" });

        await flush();
        const snap = queue.getSnapshot();
        expect(snap.running?.text).toBe("a");
        expect(snap.queued.map((e) => e.text)).toEqual(["b", "c"]);
        expect(snap.paused).toBe(false);

        dispatcher.calls[0].resolve({});
        await a.completion;
    });

    it("logs telemetry events", async () => {
        const dispatcher = new ControllableDispatcher();
        const { broadcaster } = makeRecorder();
        const logged: Array<{ name: string; data: unknown }> = [];
        const queue = new RequestQueue(
            (ctx) =>
                dispatcher.processCommand(
                    ctx.text,
                    ctx.clientRequestId,
                    ctx.attachments,
                    ctx.options,
                    ctx.requestId,
                ),
            broadcaster,
            { logEvent: (name, data) => logged.push({ name, data }) },
        );

        const e = queue.submit({ text: "x", originatorConnectionId: "c1" });
        await flush();
        dispatcher.calls[0].resolve({});
        await e.completion;

        const names = logged.map((l) => l.name);
        expect(names).toContain("requestQueue:submit");
        expect(names).toContain("requestQueue:start");
        expect(names).toContain("requestQueue:complete");
    });

    it("drainAndStop resolves after queue drains", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const e = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();

        let stopped = false;
        const stopPromise = queue.drainAndStop().then(() => {
            stopped = true;
        });

        expect(stopped).toBe(false);
        // New submits after stop should throw.
        expect(() =>
            queue.submit({ text: "b", originatorConnectionId: "c1" }),
        ).toThrow();

        dispatcher.calls[0].resolve({});
        await e.completion;
        await stopPromise;
        expect(stopped).toBe(true);
    });

    it("drainAndStop resolves immediately when idle", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);
        await expect(queue.drainAndStop()).resolves.toBeUndefined();
    });

    it("client disconnect does not affect the drain loop", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        const b = queue.submit({ text: "b", originatorConnectionId: "c1" });

        await flush();
        // Simulate originator disconnect.
        queue.onClientDisconnect("c1");

        dispatcher.calls[0].resolve({});
        await a.completion;
        await flush();
        expect(dispatcher.calls.length).toBe(2);
        dispatcher.calls[1].resolve({});
        await b.completion;
    });

    // ───── T9 ─────────────────────────────────────────────────────────
    it("submit beyond MAX_QUEUE_DEPTH throws QueueFullError", () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        // Fill queue to the cap. The first submit becomes head; the next
        // 99 land in tail. Total in-flight depth = MAX_QUEUE_DEPTH.
        for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
            queue.submit({ text: `t${i}`, originatorConnectionId: "c1" });
        }
        expect(() =>
            queue.submit({ text: "overflow", originatorConnectionId: "c1" }),
        ).toThrow(QueueFullError);
    });

    // ───── T1 ─────────────────────────────────────────────────────────
    it("cancelQueued racing against shift: entry never executes", async () => {
        // Drive the inner dispatcher manually: when the head entry's
        // processCommand is invoked, that proves the drain loop got
        // past the cancel-skip check. We want to assert the OPPOSITE
        // for the cancelled entry. The harness here cancels the second
        // entry IMMEDIATELY after submit (synchronously, before the
        // drain microtask runs the second iteration), then drives the
        // first entry to completion and asserts the second never made
        // it to processCommand.
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        const b = queue.submit({ text: "b", originatorConnectionId: "c1" });

        await flush();
        // a is running, b is queued. Cancel b before a completes.
        expect(queue.cancelQueued(b.requestId, "user")).toBe(true);

        // Finish a; drain loop should NOT call processCommand for b.
        dispatcher.calls[0].resolve({});
        await a.completion;
        await flush();
        await flush();
        expect(dispatcher.calls.length).toBe(1);
        expect((await b.completion)?.cancelled).toBe(true);
    });

    // ───── T4 ─────────────────────────────────────────────────────────
    it("drainAndStop is idempotent across concurrent invocations", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const e = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();

        const p1 = queue.drainAndStop();
        const p2 = queue.drainAndStop();
        const p3 = queue.drainAndStop();

        // All three must resolve after the queue drains; none should
        // do anything different.
        dispatcher.calls[0].resolve({});
        await e.completion;
        await Promise.all([p1, p2, p3]);
        // Re-calling after stop returns immediately and does not reject.
        await expect(queue.drainAndStop()).resolves.toBeUndefined();
    });

    // ───── T5 ─────────────────────────────────────────────────────────
    it("cancelQueued of an already-completed requestId returns false (not_found)", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const e = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();
        dispatcher.calls[0].resolve({});
        await e.completion;
        await flush();

        // cancelQueued only operates on the tail; head was already
        // shifted, completed, and cleared. Cancel returns false.
        expect(queue.cancelQueued(e.requestId, "user")).toBe(false);
        // classifyCancel returns "not_found" so callers can branch.
        expect(queue.classifyCancel(e.requestId, "user")).toBe("not_found");
    });

    // ───── T2 ─────────────────────────────────────────────────────────
    it("inner processCommand throwing synchronously does not stall the drain loop", async () => {
        // Use a custom inner that throws synchronously on the first
        // call, then behaves normally on subsequent calls.
        let callCount = 0;
        const { events: _ev, broadcaster } = makeRecorder();
        const queue = new RequestQueue((ctx) => {
            callCount++;
            if (callCount === 1) {
                throw new Error("sync boom");
            }
            return Promise.resolve({} as CommandResult);
        }, broadcaster);

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        const b = queue.submit({ text: "b", originatorConnectionId: "c1" });

        await expect(a.completion).rejects.toThrow("sync boom");
        await expect(b.completion).resolves.toBeDefined();
        expect(callCount).toBe(2);
    });

    // ───── T3 ─────────────────────────────────────────────────────────
    it("a throwing broadcaster does not break internal state or subsequent broadcasts", async () => {
        const dispatcher = new ControllableDispatcher();
        const queuedSeen: string[] = [];
        const snapshotSeen: number[] = [];
        const broadcaster: QueueBroadcaster = {
            requestQueued(entry) {
                queuedSeen.push(entry.requestId);
                throw new Error("client A is hostile");
            },
            requestStarted() {},
            requestCancelled() {},
            queueStateChanged(snapshot) {
                snapshotSeen.push(snapshot.queued.length);
            },
        };
        const queue = new RequestQueue(
            (ctx) =>
                dispatcher.processCommand(
                    ctx.text,
                    ctx.clientRequestId,
                    ctx.attachments,
                    ctx.options,
                    ctx.requestId,
                ),
            broadcaster,
        );

        // The first submit's requestQueued throws, but submission must
        // still succeed and queueStateChanged must still fire.
        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        expect(queuedSeen.length).toBe(1);
        // queueStateChanged was emitted right after the throw.
        expect(snapshotSeen.length).toBeGreaterThanOrEqual(1);

        // Internal state must remain consistent — getSnapshot still
        // works and the entry can be drained.
        expect(
            queue.getSnapshot().running?.text ??
                queue.getSnapshot().queued[0].text,
        ).toBe("a");

        await flush();
        dispatcher.calls[0].resolve({});
        await a.completion;
    });

    it("F1: cancelInFlight is empty after multiple cancels", async () => {
        // Submit several entries, cancel them all, drain, and verify
        // the cancelInFlight set never accumulates stale ids.
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
            const e = queue.submit({
                text: `t${i}`,
                originatorConnectionId: "c1",
            });
            ids.push(e.requestId);
        }
        await flush();
        // First entry is running; resolve it so the queue drains.
        dispatcher.calls[0].resolve({});
        await flush();

        // Cancel all queued entries. Each cancel must clean up its
        // cancelInFlight reservation immediately on splice.
        for (const id of ids.slice(1)) {
            queue.cancelQueued(id, "user");
        }
        expect(queue.__testGetCancelInFlightSize()).toBe(0);
    });

    it("F7: drainAndStop honors deadline by abandoning hung entries", async () => {
        // Start three entries whose innerProcessCommand will never
        // resolve. drainAndStop(short deadline) must reject every
        // outstanding completion with ServerStoppingError and emit
        // requestCancelled with reason "server_stopping".
        const dispatcher = new ControllableDispatcher();
        const { queue, events } = makeQueue(dispatcher);

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        const b = queue.submit({ text: "b", originatorConnectionId: "c1" });
        const c = queue.submit({ text: "c", originatorConnectionId: "c1" });

        await flush();

        const completions = [a.completion, b.completion, c.completion].map(
            (p) => p.catch((e) => e),
        );

        await queue.drainAndStop(50);

        const results = await Promise.all(completions);
        for (const r of results) {
            expect(r).toBeInstanceOf(ServerStoppingError);
        }

        const cancelled = events.filter((e) => e.type === "cancelled");
        expect(cancelled.length).toBeGreaterThanOrEqual(3);
        for (const e of cancelled) {
            if (e.type === "cancelled") {
                expect(e.reason).toBe("server_stopping");
            }
        }

        // Subsequent submits must reject with ServerStoppingError.
        expect(() =>
            queue.submit({ text: "d", originatorConnectionId: "c1" }),
        ).toThrow(ServerStoppingError);
    });

    // ----- interrupt() -----------------------------------------------------

    it("interrupt with no running entry prepends and dispatches immediately", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue, events } = makeQueue(dispatcher);

        // Nothing running. Interrupt should behave like submit but
        // still log under the interrupt name.
        const entry = queue.interrupt({
            text: "go",
            originatorConnectionId: "c1",
        });

        await flush();
        expect(dispatcher.calls.length).toBe(1);
        expect(dispatcher.calls[0].command).toBe("go");
        expect(dispatcher.calls[0].requestId).toBe(entry.requestId);

        dispatcher.calls[0].resolve({});
        await entry.completion;

        // queued + snapshot + started + snapshot + final snapshot
        const types = events.map((e) => e.type);
        expect(types).toEqual([
            "queued",
            "snapshot",
            "started",
            "snapshot",
            "snapshot",
        ]);
    });

    it("interrupt prepends ahead of queued entries (head of tail)", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        const b = queue.submit({ text: "b", originatorConnectionId: "c1" });
        const c = queue.submit({ text: "c", originatorConnectionId: "c1" });
        await flush();

        // a is running; b, c queued.
        expect(queue.getSnapshot().queued.map((e) => e.text)).toEqual([
            "b",
            "c",
        ]);

        const x = queue.interrupt({
            text: "x",
            originatorConnectionId: "c1",
        });
        // Tail order should be [x, b, c]; a still running.
        expect(queue.getSnapshot().queued.map((e) => e.text)).toEqual([
            "x",
            "b",
            "c",
        ]);

        // Caller is responsible for cancelling the running entry; the
        // queue itself does not. Finish a normally and verify x runs
        // next (before b and c).
        dispatcher.calls[0].resolve({});
        await a.completion;
        await flush();
        expect(dispatcher.calls[1].command).toBe("x");
        dispatcher.calls[1].resolve({});
        await x.completion;
        await flush();
        expect(dispatcher.calls[2].command).toBe("b");
        dispatcher.calls[2].resolve({});
        await b.completion;
        await flush();
        expect(dispatcher.calls[3].command).toBe("c");
        dispatcher.calls[3].resolve({});
        await c.completion;
    });

    it("interrupt at MAX_QUEUE_DEPTH throws QueueFullError", () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);
        for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
            queue.submit({
                text: `q${i}`,
                originatorConnectionId: "c1",
            });
        }
        expect(() =>
            queue.interrupt({ text: "x", originatorConnectionId: "c1" }),
        ).toThrow(QueueFullError);
    });

    it("interrupt after stop throws ServerStoppingError", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);
        // Stop synchronously with no in-flight work.
        const stop = queue.drainAndStop(100);
        await stop;
        expect(() =>
            queue.interrupt({ text: "x", originatorConnectionId: "c1" }),
        ).toThrow(ServerStoppingError);
    });

    it("interrupt then concurrent submit: submit lands behind interrupt", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);

        // Get something running.
        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();
        expect(dispatcher.calls[0].command).toBe("a");

        // Interrupt prepends "x" at head of tail. A concurrent submit
        // of "y" must land AFTER "x" (push to end of tail).
        const x = queue.interrupt({
            text: "x",
            originatorConnectionId: "c1",
        });
        const y = queue.submit({ text: "y", originatorConnectionId: "c1" });

        expect(queue.getSnapshot().queued.map((e) => e.text)).toEqual([
            "x",
            "y",
        ]);

        // Drain to verify the dispatch order matches the tail order.
        dispatcher.calls[0].resolve({});
        await a.completion;
        await flush();
        expect(dispatcher.calls[1].command).toBe("x");
        dispatcher.calls[1].resolve({});
        await x.completion;
        await flush();
        expect(dispatcher.calls[2].command).toBe("y");
        dispatcher.calls[2].resolve({});
        await y.completion;
    });

    it("interrupt logs requestQueue:interrupt telemetry", async () => {
        const dispatcher = new ControllableDispatcher();
        const { broadcaster } = makeRecorder();
        const logged: Array<{ name: string; data: any }> = [];
        const queue = new RequestQueue(
            (ctx) =>
                dispatcher.processCommand(
                    ctx.text,
                    ctx.clientRequestId,
                    ctx.attachments,
                    ctx.options,
                    ctx.requestId,
                ),
            broadcaster,
            { logEvent: (name, data) => logged.push({ name, data }) },
        );

        queue.interrupt({ text: "x", originatorConnectionId: "c1" });
        const tele = logged.find((l) => l.name === "requestQueue:interrupt");
        expect(tele).toBeDefined();
        expect(tele!.data.queuedAhead).toBe(0);
    });

    // ----- onAllClientsDisconnected / onClientReconnected -----------------

    it("grace timer cancels queued entries with reason no_clients", async () => {
        jest.useFakeTimers();
        try {
            const dispatcher = new ControllableDispatcher();
            const { queue, events } = makeQueue(dispatcher);

            const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
            const b = queue.submit({ text: "b", originatorConnectionId: "c1" });
            const c = queue.submit({ text: "c", originatorConnectionId: "c1" });
            // Drain to start a.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            expect(queue.getSnapshot().running?.text).toBe("a");

            queue.onAllClientsDisconnected(1000);
            expect(queue.__testHasGraceTimer()).toBe(true);

            // Fire grace timer.
            jest.advanceTimersByTime(1000);
            expect(queue.__testHasGraceTimer()).toBe(false);

            // a is still running; b, c cancelled.
            const snap = queue.getSnapshot();
            expect(snap.running?.text).toBe("a");
            expect(snap.queued).toEqual([]);

            const cancellations = events.filter(
                (e) => e.type === "cancelled",
            ) as any[];
            expect(cancellations.map((e) => e.reason)).toEqual([
                "no_clients",
                "no_clients",
            ]);

            // Finish a to drain the in-flight side.
            dispatcher.calls[0].resolve({});
            await a.completion;
            const bRes = await b.completion;
            const cRes = await c.completion;
            expect(bRes?.cancelled).toBe(true);
            expect(cRes?.cancelled).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("client reconnect before grace expires clears the timer", () => {
        jest.useFakeTimers();
        try {
            const dispatcher = new ControllableDispatcher();
            const { queue } = makeQueue(dispatcher);
            queue.submit({ text: "a", originatorConnectionId: "c1" });

            queue.onAllClientsDisconnected(1000);
            expect(queue.__testHasGraceTimer()).toBe(true);

            // Reconnect halfway through.
            jest.advanceTimersByTime(500);
            queue.onClientReconnected();
            expect(queue.__testHasGraceTimer()).toBe(false);

            // No cancellations even after the original deadline would
            // have expired.
            jest.advanceTimersByTime(2000);
            expect(queue.__testHasGraceTimer()).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    it("grace timer invokes onExpiry callback with running snapshot", async () => {
        jest.useFakeTimers();
        try {
            const dispatcher = new ControllableDispatcher();
            const { queue } = makeQueue(dispatcher);
            const a = queue.submit({
                text: "a",
                originatorConnectionId: "c1",
            });
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            let called = false;
            let received: any = undefined;
            queue.onAllClientsDisconnected(500, (head) => {
                called = true;
                received = head;
            });
            jest.advanceTimersByTime(500);
            expect(called).toBe(true);
            expect(received?.text).toBe("a");

            dispatcher.calls[0].resolve({});
            await a.completion;
        } finally {
            jest.useRealTimers();
        }
    });

    it("onAllClientsDisconnected is idempotent (no overlapping timers)", () => {
        jest.useFakeTimers();
        try {
            const dispatcher = new ControllableDispatcher();
            const { queue } = makeQueue(dispatcher);
            queue.onAllClientsDisconnected(1000);
            queue.onAllClientsDisconnected(1000);
            queue.onAllClientsDisconnected(1000);
            expect(queue.__testHasGraceTimer()).toBe(true);
            queue.onClientReconnected();
            expect(queue.__testHasGraceTimer()).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    it("markBlocked / markUnblocked round-trips on snapshot", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue, events } = makeQueue(dispatcher);
        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();
        expect(queue.getSnapshot().running?.text).toBe("a");
        expect(queue.getSnapshot().running?.blockedOn).toBeUndefined();

        queue.markBlocked(a.requestId, "interaction");
        expect(queue.getSnapshot().running?.blockedOn).toBe("interaction");

        queue.markUnblocked(a.requestId);
        expect(queue.getSnapshot().running?.blockedOn).toBeUndefined();

        // Each mark should broadcast a snapshot change.
        const snapEvents = events.filter((e) => e.type === "snapshot");
        expect(snapEvents.length).toBeGreaterThanOrEqual(2);

        dispatcher.calls[0].resolve({});
        await a.completion;
    });

    // R4 review fix: overlapping interactions must reference-count
    // the `blockedOn` flag so a resolving sibling does not clear the
    // wire-visible flag while another interaction is still pending.
    it("markBlocked ref-counts overlapping interactions", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue, events } = makeQueue(dispatcher);
        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();

        // Two overlapping holds (e.g. Promise.all([question, proposeAction])).
        queue.markBlocked(a.requestId, "interaction");
        expect(queue.getSnapshot().running?.blockedOn).toBe("interaction");
        const snapsAfter1stBlock = events.filter(
            (e) => e.type === "snapshot",
        ).length;

        queue.markBlocked(a.requestId, "interaction");
        expect(queue.getSnapshot().running?.blockedOn).toBe("interaction");
        // Second markBlocked should NOT produce another snapshot —
        // the wire state didn't change.
        expect(events.filter((e) => e.type === "snapshot").length).toBe(
            snapsAfter1stBlock,
        );

        // First unblock: still pending → blockedOn stays.
        queue.markUnblocked(a.requestId);
        expect(queue.getSnapshot().running?.blockedOn).toBe("interaction");
        // Should not broadcast snapshot — observable state unchanged.
        expect(events.filter((e) => e.type === "snapshot").length).toBe(
            snapsAfter1stBlock,
        );

        // Second unblock: count reaches zero → blockedOn clears,
        // snapshot fires.
        queue.markUnblocked(a.requestId);
        expect(queue.getSnapshot().running?.blockedOn).toBeUndefined();
        expect(events.filter((e) => e.type === "snapshot").length).toBe(
            snapsAfter1stBlock + 1,
        );

        // Extra unblock is a no-op (count can't go negative).
        queue.markUnblocked(a.requestId);
        expect(queue.getSnapshot().running?.blockedOn).toBeUndefined();

        dispatcher.calls[0].resolve({});
        await a.completion;
    });

    // R2 review fix + Round 2 update: cancelRunning broadcasts
    // requestCancelled so other clients see the explicit cancel
    // event, but DOES NOT broadcast a paired queueStateChanged
    // (the head's state is still "running" at this point — a
    // paired snapshot would carry stale running=<entry> and
    // race-resurrect the cancelled entry on the client under
    // strict-`<` admission). The authoritative snapshot is the
    // drain-loop completion broadcast at version+1.
    it("cancelRunning broadcasts requestCancelled but not a paired snapshot", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue, events } = makeQueue(dispatcher);
        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();
        expect(queue.getSnapshot().running?.requestId).toBe(a.requestId);

        const cancelsBefore = events.filter(
            (e) => e.type === "cancelled",
        ).length;
        const snapsBefore = events.filter((e) => e.type === "snapshot").length;

        const ok = queue.cancelRunning(a.requestId, "user");
        expect(ok).toBe(true);

        const cancels = events.filter((e) => e.type === "cancelled");
        expect(cancels.length).toBe(cancelsBefore + 1);
        const evt = cancels[cancels.length - 1] as {
            requestId: string;
            reason: QueueCancelReason;
        };
        expect(evt.requestId).toBe(a.requestId);
        expect(evt.reason).toBe("user");
        // Round 2 review fix: no paired snapshot from cancelRunning.
        expect(events.filter((e) => e.type === "snapshot").length).toBe(
            snapsBefore,
        );

        // Idempotent: a second call returns false and emits nothing.
        const ok2 = queue.cancelRunning(a.requestId, "user");
        expect(ok2).toBe(false);
        expect(events.filter((e) => e.type === "cancelled").length).toBe(
            cancelsBefore + 1,
        );

        // After the drain loop finishes, a fresh snapshot DOES fire
        // (state="cancelled", error="cancelled:user", running=null).
        dispatcher.calls[0].resolve({ cancelled: true });
        await a.completion;
        expect(
            events.filter((e) => e.type === "snapshot").length,
        ).toBeGreaterThan(snapsBefore);
    });

    // R2/R3 review fix: when cancelRunning records a reason and the
    // inner command resolves cancelled, the entry's wire `error`
    // field must carry "cancelled:<reason>" so consumers can render
    // the cause (e.g. "cancelled: no clients connected").
    it("cancelRunning reason is preserved on the wire as cancelled:<reason>", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);
        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();

        queue.cancelRunning(a.requestId, "no_clients");
        // Inner dispatcher eventually returns cancelled (the
        // AbortController fire is simulated by resolving with
        // cancelled:true here).
        dispatcher.calls[0].resolve({ cancelled: true });
        await a.completion;

        expect(a.state).toBe("cancelled");
        expect(a.error).toBe("cancelled:no_clients");
    });

    // R3 review fix companion: when the inner command throws an
    // AbortError-shaped Error (the path the no-clients onExpiry
    // takes via pendingInteractions.cancel), and cancelRunning has
    // primed the reason, the drain loop must classify the entry as
    // cancelled rather than failed.
    it("AbortError-shaped throw with primed cancelReason yields cancelled (not failed)", async () => {
        const dispatcher = new ControllableDispatcher();
        const { queue } = makeQueue(dispatcher);
        const a = queue.submit({ text: "a", originatorConnectionId: "c1" });
        await flush();

        queue.cancelRunning(a.requestId, "no_clients");
        const abortErr = new Error("simulated abort");
        abortErr.name = "AbortError";
        dispatcher.calls[0].reject(abortErr);
        // Should resolve (not reject) because the drain loop
        // re-classifies the AbortError as a cancellation.
        await expect(a.completion).resolves.toMatchObject({
            cancelled: true,
        });

        expect(a.state).toBe("cancelled");
        expect(a.error).toBe("cancelled:no_clients");
    });
});
