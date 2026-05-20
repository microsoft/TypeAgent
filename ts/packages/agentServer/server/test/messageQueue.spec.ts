// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommandResult,
    Dispatcher,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";

import { MessageQueue, QueueBroadcaster } from "../src/messageQueue.js";

type RecordedEvent =
    | { type: "queued"; entry: QueuedRequest }
    | { type: "started"; entry: QueuedRequest }
    | { type: "cancelled"; requestId: string; reason: QueueCancelReason }
    | { type: "snapshot"; snapshot: QueueSnapshot };

function makeRecorder(): {
    events: RecordedEvent[];
    broadcaster: QueueBroadcaster;
} {
    const events: RecordedEvent[] = [];
    const broadcaster: QueueBroadcaster = {
        requestQueued(entry) {
            events.push({ type: "queued", entry });
        },
        requestStarted(entry) {
            events.push({ type: "started", entry });
        },
        requestCancelled(requestId, reason) {
            events.push({ type: "cancelled", requestId, reason });
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
    const queue = new MessageQueue(
        () => dispatcher as unknown as Dispatcher,
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

describe("MessageQueue", () => {
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
        const queue = new MessageQueue(
            () => dispatcher as unknown as Dispatcher,
            broadcaster,
            { logEvent: (name, data) => logged.push({ name, data }) },
        );

        const e = queue.submit({ text: "x", originatorConnectionId: "c1" });
        await flush();
        dispatcher.calls[0].resolve({});
        await e.completion;

        const names = logged.map((l) => l.name);
        expect(names).toContain("messageQueue:submit");
        expect(names).toContain("messageQueue:start");
        expect(names).toContain("messageQueue:complete");
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
});
