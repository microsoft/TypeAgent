// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration tests for RequestQueue + multi-client broadcast. Drives the queue
 * directly with a small `MultiClientBus` reproducing SharedDispatcher's
 * "every push event reaches every connected client" behavior.
 */

import type {
    CommandResult,
    Dispatcher,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
import { RequestQueue, QueueBroadcaster } from "../src/requestQueue.js";

interface ClientRecorder {
    name: string;
    queued: QueuedRequest[];
    started: QueuedRequest[];
    cancelled: Array<{ requestId: string; reason: QueueCancelReason }>;
    snapshots: QueueSnapshot[];
}

function makeRecorder(name: string): ClientRecorder {
    return {
        name,
        queued: [],
        started: [],
        cancelled: [],
        snapshots: [],
    };
}

/**
 * Mirrors SharedDispatcher's broadcaster: a single bus fans every event out
 * to every connected client. Disconnected clients stop receiving events.
 */
class MultiClientBus implements QueueBroadcaster {
    private readonly clients = new Map<string, ClientRecorder>();

    connect(name: string): ClientRecorder {
        const r = makeRecorder(name);
        this.clients.set(name, r);
        return r;
    }
    disconnect(name: string): void {
        this.clients.delete(name);
    }

    requestQueued(entry: QueuedRequest, _version: number): void {
        for (const r of this.clients.values()) r.queued.push({ ...entry });
    }
    requestStarted(entry: QueuedRequest, _version: number): void {
        for (const r of this.clients.values()) r.started.push({ ...entry });
    }
    requestCancelled(
        requestId: string,
        reason: QueueCancelReason,
        _version: number,
    ): void {
        for (const r of this.clients.values()) {
            r.cancelled.push({ requestId, reason });
        }
    }
    queueStateChanged(snapshot: QueueSnapshot): void {
        const cloned: QueueSnapshot = {
            running: snapshot.running ? { ...snapshot.running } : null,
            queued: snapshot.queued.map((e) => ({ ...e })),
            paused: snapshot.paused,
            version: snapshot.version,
        };
        for (const r of this.clients.values()) r.snapshots.push(cloned);
    }
}

/** Controllable inner dispatcher; drain loop awaits processCommand. */
class ControllableDispatcher implements Pick<Dispatcher, "processCommand"> {
    public calls: Array<{
        command: string;
        requestId: string | undefined;
        resolve: (r: CommandResult | undefined) => void;
        reject: (e: unknown) => void;
        promise: Promise<CommandResult | undefined>;
    }> = [];
    processCommand = (
        command: string,
        _clientRequestId?: unknown,
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
        this.calls.push({ command, requestId, resolve, reject, promise });
        return promise;
    };
}

const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
};

function setup() {
    const dispatcher = new ControllableDispatcher();
    const bus = new MultiClientBus();
    const queue = new RequestQueue(
        (ctx) =>
            dispatcher.processCommand(
                ctx.text,
                ctx.clientRequestId,
                ctx.attachments,
                ctx.options,
                ctx.requestId,
            ),
        bus,
    );
    return { dispatcher, bus, queue };
}

describe("RequestQueue — multi-client integration", () => {
    it("drains in submit order across clients (interleaved A/B submits)", async () => {
        const { dispatcher, bus, queue } = setup();
        const a = bus.connect("A");
        const b = bus.connect("B");

        // A:1, A:2, B:4, A:3 — submit order is the canonical order.
        const a1 = queue.submit({ text: "a1", originatorConnectionId: "A" });
        const a2 = queue.submit({ text: "a2", originatorConnectionId: "A" });
        const b4 = queue.submit({ text: "b4", originatorConnectionId: "B" });
        const a3 = queue.submit({ text: "a3", originatorConnectionId: "A" });

        await flush();
        // a1 starts immediately; rest are queued in submit order.
        expect(dispatcher.calls.map((c) => c.command)).toEqual(["a1"]);
        const snapBeforeDrain = queue.getSnapshot();
        expect(snapBeforeDrain.running?.text).toBe("a1");
        expect(snapBeforeDrain.queued.map((e) => e.text)).toEqual([
            "a2",
            "b4",
            "a3",
        ]);

        // Both clients see the four queued events and at least one started.
        expect(a.queued.map((e) => e.text)).toEqual(["a1", "a2", "b4", "a3"]);
        expect(b.queued.map((e) => e.text)).toEqual(["a1", "a2", "b4", "a3"]);
        expect(a.started.map((e) => e.text)).toEqual(["a1"]);
        expect(b.started.map((e) => e.text)).toEqual(["a1"]);

        // Drain in order.
        dispatcher.calls[0].resolve({});
        await a1.completion;
        await flush();
        dispatcher.calls[1].resolve({});
        await a2.completion;
        await flush();
        dispatcher.calls[2].resolve({});
        await b4.completion;
        await flush();
        dispatcher.calls[3].resolve({});
        await a3.completion;

        expect(dispatcher.calls.map((c) => c.command)).toEqual([
            "a1",
            "a2",
            "b4",
            "a3",
        ]);
        // Every client sees every started event.
        expect(a.started.map((e) => e.text)).toEqual(["a1", "a2", "b4", "a3"]);
        expect(b.started.map((e) => e.text)).toEqual(["a1", "a2", "b4", "a3"]);
        const final = queue.getSnapshot();
        expect(final.running).toBeNull();
        expect(final.queued).toEqual([]);
    });

    it("cross-client cancel of a queued entry broadcasts to all clients", async () => {
        const { dispatcher, bus, queue } = setup();
        const a = bus.connect("A");
        const b = bus.connect("B");

        const a1 = queue.submit({ text: "a1", originatorConnectionId: "A" });
        const a2 = queue.submit({ text: "a2", originatorConnectionId: "A" });
        const a3 = queue.submit({ text: "a3", originatorConnectionId: "A" });
        await flush();
        expect(dispatcher.calls.length).toBe(1); // a1 running

        // Client B cancels A's queued a3.
        const removed = queue.cancelQueued(a3.requestId, "user");
        expect(removed).toBe(true);

        for (const r of [a, b]) {
            const ev = r.cancelled.find((e) => e.requestId === a3.requestId);
            expect(ev).toBeDefined();
            expect(ev!.reason).toBe("user");
        }
        const snap = queue.getSnapshot();
        expect(snap.running?.text).toBe("a1");
        expect(snap.queued.map((e) => e.text)).toEqual(["a2"]);

        // Subsequent submits still work and reach both clients.
        const a4 = queue.submit({ text: "a4", originatorConnectionId: "A" });
        await flush();
        expect(a.queued.find((e) => e.text === "a4")).toBeDefined();
        expect(b.queued.find((e) => e.text === "a4")).toBeDefined();

        // a3's completion resolves with cancelled.
        const a3Result = await a3.completion;
        expect(a3Result?.cancelled).toBe(true);

        // Drain remaining.
        dispatcher.calls[0].resolve({});
        await a1.completion;
        await flush();
        dispatcher.calls[1].resolve({});
        await a2.completion;
        await flush();
        dispatcher.calls[2].resolve({});
        await a4.completion;
    });

    it("originator disconnect mid-queue does not stall the drain", async () => {
        const { dispatcher, bus, queue } = setup();
        bus.connect("A");
        bus.connect("B");

        const a1 = queue.submit({ text: "a1", originatorConnectionId: "A" });
        const a2 = queue.submit({ text: "a2", originatorConnectionId: "A" });
        const a3 = queue.submit({ text: "a3", originatorConnectionId: "A" });
        await flush();
        expect(dispatcher.calls.length).toBe(1);

        // Disconnect A. Per design, this does NOT cancel A's queued items.
        queue.onClientDisconnect("A");
        bus.disconnect("A");

        // Drain a1, then a2 must still execute.
        dispatcher.calls[0].resolve({});
        await a1.completion;
        await flush();
        expect(dispatcher.calls.length).toBe(2);
        expect(dispatcher.calls[1].command).toBe("a2");
        dispatcher.calls[1].resolve({});
        await a2.completion;
        await flush();
        expect(dispatcher.calls.length).toBe(3);
        expect(dispatcher.calls[2].command).toBe("a3");
        dispatcher.calls[2].resolve({});
        await a3.completion;
    });

    it("getSnapshot reflects expected state at each milestone", async () => {
        const { dispatcher, bus, queue } = setup();
        bus.connect("A");

        expect(queue.getSnapshot()).toEqual({
            running: null,
            queued: [],
            paused: false,
            version: 0,
        });

        const a1 = queue.submit({ text: "a1", originatorConnectionId: "A" });
        queue.submit({ text: "a2", originatorConnectionId: "A" });
        await flush();

        let snap = queue.getSnapshot();
        expect(snap.running?.text).toBe("a1");
        expect(snap.queued.map((e) => e.text)).toEqual(["a2"]);

        dispatcher.calls[0].resolve({});
        await a1.completion;
        await flush();

        snap = queue.getSnapshot();
        expect(snap.running?.text).toBe("a2");
        expect(snap.queued).toEqual([]);

        dispatcher.calls[1].resolve({});
        await dispatcher.calls[1].promise;
        await flush();

        snap = queue.getSnapshot();
        expect(snap.running).toBeNull();
        expect(snap.queued).toEqual([]);
    });

    it("a late-joining client sees the current snapshot (JoinConversationResult.queueSnapshot)", async () => {
        const { dispatcher, bus, queue } = setup();
        bus.connect("A");

        queue.submit({ text: "a1", originatorConnectionId: "A" });
        queue.submit({ text: "a2", originatorConnectionId: "A" });
        queue.submit({ text: "a3", originatorConnectionId: "A" });
        await flush();

        // Late-joining client C — the server's joinConversation handler
        // would call sharedDispatcher.getQueueSnapshot() at this point
        // and stuff it into JoinConversationResult.queueSnapshot.
        const joinSnap = queue.getSnapshot();
        expect(joinSnap.running?.text).toBe("a1");
        expect(joinSnap.queued.map((e) => e.text)).toEqual(["a2", "a3"]);

        // After drain begins, the snapshot keeps advancing.
        dispatcher.calls[0].resolve({});
        await dispatcher.calls[0].promise;
        await flush();
        const snap2 = queue.getSnapshot();
        expect(snap2.running?.text).toBe("a2");
        expect(snap2.queued.map((e) => e.text)).toEqual(["a3"]);
    });

    // T6
    it("concurrent submits from the same client preserve FIFO order", async () => {
        const { dispatcher, bus, queue } = setup();
        bus.connect("A");

        // queue.submit is sync; Promise.all just asserts all returned.
        const entries = await Promise.all(
            [0, 1, 2, 3, 4].map((i) =>
                Promise.resolve(
                    queue.submit({
                        text: `t${i}`,
                        originatorConnectionId: "A",
                    }),
                ),
            ),
        );
        expect(entries.map((e) => e.text)).toEqual([
            "t0",
            "t1",
            "t2",
            "t3",
            "t4",
        ]);
        await flush();

        // Drain in order; assert command order matches submit order.
        for (let i = 0; i < entries.length; i++) {
            await flush();
            expect(dispatcher.calls[i].command).toBe(`t${i}`);
            dispatcher.calls[i].resolve({});
            await entries[i].completion;
        }
    });

    // T10
    it("attachments are redacted from broadcasts (only attachmentCount leaks)", async () => {
        const { dispatcher, bus, queue } = setup();
        const a = bus.connect("A");

        queue.submit({
            text: "with-attachments",
            originatorConnectionId: "A",
            attachments: ["data:image/png;base64,XXXX", "secret-bytes"],
        });
        await flush();

        // The queued event payload must NOT carry `attachments` and
        // MUST carry attachmentCount = 2.
        const queuedEvt = a.queued.find((e) => e.text === "with-attachments");
        expect(queuedEvt).toBeDefined();
        expect((queuedEvt as any).attachments).toBeUndefined();
        expect(queuedEvt!.attachmentCount).toBe(2);

        // Same expectation on the snapshot.
        const snap = queue.getSnapshot();
        const visible = snap.running ?? snap.queued[0];
        expect(visible).toBeDefined();
        expect((visible as any).attachments).toBeUndefined();
        expect(visible!.attachmentCount).toBe(2);

        dispatcher.calls[0].resolve({});
    });

    // T8
    it("event ordering: requestQueued precedes requestStarted; requestCancelled precedes next requestStarted", async () => {
        const { dispatcher, bus, queue } = setup();
        const a = bus.connect("A");

        // Submit three; cancel the middle before drain reaches it. Expected
        // timeline: queued(t0,t1,t2), started(t0), cancelled(t1), started(t2).
        const t0 = queue.submit({ text: "t0", originatorConnectionId: "A" });
        const t1 = queue.submit({ text: "t1", originatorConnectionId: "A" });
        const t2 = queue.submit({ text: "t2", originatorConnectionId: "A" });

        // cancelQueued only works on tail entries.
        await flush();
        expect(queue.cancelQueued(t1.requestId, "user")).toBe(true);

        // For t0: requestQueued must precede requestStarted.
        const t0QueuedIdx = a.queued.findIndex(
            (e) => e.requestId === t0.requestId,
        );
        const t0StartedIdx = a.started.findIndex(
            (e) => e.requestId === t0.requestId,
        );
        expect(t0QueuedIdx).toBeGreaterThanOrEqual(0);
        expect(t0StartedIdx).toBeGreaterThanOrEqual(0);

        // Drain t0 -> t2 (t1 was cancelled).
        dispatcher.calls[0].resolve({});
        await t0.completion;
        await flush();
        expect(dispatcher.calls.length).toBe(2);
        expect(dispatcher.calls[1].command).toBe("t2");

        // cancelled(t1) must precede started(t2). Assert via the order of
        // queueStateChanged snapshots, which interleave both streams: snapshot
        // after cancel has tail=[t2]; snapshot after t2 starts has running=t2.
        const cancelSnapIdx = a.snapshots.findIndex(
            (s) => s.queued.length === 1 && s.queued[0].text === "t2",
        );
        const t2RunningSnapIdx = a.snapshots.findIndex(
            (s) => s.running?.text === "t2",
        );
        expect(cancelSnapIdx).toBeGreaterThanOrEqual(0);
        expect(t2RunningSnapIdx).toBeGreaterThan(cancelSnapIdx);

        dispatcher.calls[1].resolve({});
        await t2.completion;
    });
});
