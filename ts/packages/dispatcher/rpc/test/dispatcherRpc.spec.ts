// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import { createDispatcherRpcClient } from "../src/dispatcherClient.js";
import { createDispatcherRpcServer } from "../src/dispatcherServer.js";
import type {
    CommandResult,
    Dispatcher,
    QueuedRequest,
    SubmitResult,
} from "@typeagent/dispatcher-types";
import { ServerStoppingError } from "@typeagent/dispatcher-types";
import type { PendingInteractionResponse } from "@typeagent/dispatcher-types";

// ---------------------------------------------------------------------------
// In-process channel pair
//
// createChannelAdapter wraps a send function into a full RpcChannel. Wire two
// adapters back-to-back: messages sent by the client are delivered to the
// server's notifyMessage, and vice versa.
// ---------------------------------------------------------------------------
function createChannelPair() {
    let serverAdapter: ReturnType<typeof createChannelAdapter>;
    let clientAdapter: ReturnType<typeof createChannelAdapter>;

    serverAdapter = createChannelAdapter((msg, cb) => {
        clientAdapter.notifyMessage(msg);
        cb?.(null);
    });
    clientAdapter = createChannelAdapter((msg, cb) => {
        serverAdapter.notifyMessage(msg);
        cb?.(null);
    });

    return {
        serverChannel: serverAdapter.channel,
        clientChannel: clientAdapter.channel,
    };
}

// ---------------------------------------------------------------------------
// Minimal stub dispatcher — only implements the methods under test.
// All other methods throw so a test that accidentally calls them will fail
// loudly.
// ---------------------------------------------------------------------------
function makeStubDispatcher(overrides: Partial<Dispatcher> = {}): Dispatcher & {
    calls: { method: string; args: unknown[] }[];
} {
    const calls: { method: string; args: unknown[] }[] = [];

    const notImplemented =
        (name: string) =>
        (...args: unknown[]) => {
            throw new Error(`Unexpected call to ${name}(${args.join(", ")})`);
        };

    return {
        get connectionId() {
            return undefined;
        },
        submitCommand: notImplemented("submitCommand") as any,
        interrupt: notImplemented("interrupt") as any,
        getQueueSnapshot: notImplemented("getQueueSnapshot") as any,
        getDynamicDisplay: notImplemented("getDynamicDisplay") as any,
        getTemplateSchema: notImplemented("getTemplateSchema") as any,
        getTemplateCompletion: notImplemented("getTemplateCompletion") as any,
        getCommandCompletion: notImplemented("getCommandCompletion") as any,
        checkCache: notImplemented("checkCache") as any,
        close: notImplemented("close") as any,
        getStatus: notImplemented("getStatus") as any,
        getAgentSchemas: notImplemented("getAgentSchemas") as any,
        respondToChoice: notImplemented("respondToChoice") as any,
        getDisplayHistory: notImplemented("getDisplayHistory") as any,
        async cancelCommand(...args) {
            calls.push({ method: "cancelCommand", args });
            return { kind: "not_found" as const, requestId: args[0] };
        },
        cancelCommandByClientId(...args) {
            calls.push({ method: "cancelCommandByClientId", args });
        },
        async respondToInteraction(...args) {
            calls.push({ method: "respondToInteraction", args });
        },
        cancelInteraction(...args) {
            calls.push({ method: "cancelInteraction", args });
        },
        async recordUserFeedback(...args) {
            calls.push({ method: "recordUserFeedback", args });
        },
        async recordUserHide(...args: unknown[]) {
            calls.push({ method: "recordUserHide", args });
        },
        async restoreAllHidden() {
            calls.push({ method: "restoreAllHidden", args: [] });
            return 0;
        },
        async flushHidden() {
            calls.push({ method: "flushHidden", args: [] });
            return 0;
        },
        ...overrides,
        calls,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeResponse(interactionId = "id-1"): PendingInteractionResponse {
    return {
        interactionId,
        type: "question",
        value: 0,
    } as unknown as PendingInteractionResponse;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("dispatcher RPC — cancelInteraction (fire-and-forget)", () => {
    it("sends a call message and does not wait for a reply", () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const stub = makeStubDispatcher();
        createDispatcherRpcServer(stub, serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        // cancelInteraction returns void synchronously — not a Promise
        const result = client.cancelInteraction("id-42");

        expect(result).toBeUndefined();
        expect(stub.calls).toEqual([
            { method: "cancelInteraction", args: ["id-42"] },
        ]);
    });

    it("delivers the interactionId to the server handler", () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const received: string[] = [];
        const stub = makeStubDispatcher({
            cancelInteraction(id: string) {
                received.push(id);
            },
        });
        createDispatcherRpcServer(stub, serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        client.cancelInteraction("abc");
        client.cancelInteraction("xyz");

        expect(received).toEqual(["abc", "xyz"]);
    });

    it("does not create a pending invoke entry (no reply expected)", () => {
        // If cancelInteraction were still an invoke, a missing invokeResult
        // would leave the promise unresolved forever.  We verify the call
        // completes without any pending promise by confirming the return value
        // is not a Promise.
        const { serverChannel, clientChannel } = createChannelPair();
        createDispatcherRpcServer(makeStubDispatcher(), serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        const ret = client.cancelInteraction("no-reply");

        expect(ret).not.toBeInstanceOf(Promise);
    });
});

describe("dispatcher RPC — respondToInteraction (invoke / awaited)", () => {
    it("resolves after the server handler returns", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const stub = makeStubDispatcher();
        createDispatcherRpcServer(stub, serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        await expect(
            client.respondToInteraction(makeResponse()),
        ).resolves.toBeUndefined();

        expect(stub.calls).toEqual([
            {
                method: "respondToInteraction",
                args: [makeResponse()],
            },
        ]);
    });

    it("returns a Promise (awaitable)", () => {
        const { serverChannel, clientChannel } = createChannelPair();
        createDispatcherRpcServer(makeStubDispatcher(), serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        const ret = client.respondToInteraction(makeResponse());

        expect(ret).toBeInstanceOf(Promise);
        return ret; // let jest await it to avoid unhandled-rejection noise
    });

    it("rejects when the server handler throws", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const stub = makeStubDispatcher({
            async respondToInteraction() {
                throw new Error("server-side failure");
            },
        });
        createDispatcherRpcServer(stub, serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        await expect(
            client.respondToInteraction(makeResponse()),
        ).rejects.toThrow("server-side failure");
    });

    it("delivers the full response payload to the server", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const received: PendingInteractionResponse[] = [];
        const stub = makeStubDispatcher({
            async respondToInteraction(r: PendingInteractionResponse) {
                received.push(r);
            },
        });
        createDispatcherRpcServer(stub, serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        const response: PendingInteractionResponse = {
            interactionId: "interact-99",
            type: "proposeAction",
            value: { accepted: true },
        };
        await client.respondToInteraction(response);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(response);
    });
});

describe("dispatcher RPC — cancelCommand (now returns CancelResult)", () => {
    it("sends an invoke message and resolves with the typed result", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const stub = makeStubDispatcher();
        createDispatcherRpcServer(stub, serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        const result = await client.cancelCommand("req-1");

        expect(result).toEqual({ kind: "not_found", requestId: "req-1" });
        expect(stub.calls).toEqual([
            { method: "cancelCommand", args: ["req-1"] },
        ]);
    });
});

describe("dispatcher RPC — transport symmetry", () => {
    it("cancelInteraction uses a call message; cancelCommand uses invoke (returns CancelResult)", () => {
        // Intercept raw messages on the wire to confirm message type
        const sentMessages: { type: string; name: string }[] = [];

        let serverNotify: ((m: any) => void) | undefined;
        let clientNotify: ((m: any) => void) | undefined;

        const serverAdapter = createChannelAdapter((msg, cb) => {
            sentMessages.push({ type: msg.type, name: msg.name });
            clientNotify?.(msg);
            cb?.(null);
        });
        const clientAdapter = createChannelAdapter((msg, cb) => {
            sentMessages.push({ type: msg.type, name: msg.name });
            serverNotify?.(msg);
            cb?.(null);
        });

        serverNotify = serverAdapter.notifyMessage;
        clientNotify = clientAdapter.notifyMessage;

        createDispatcherRpcServer(makeStubDispatcher(), serverAdapter.channel);
        const { dispatcher: client } = createDispatcherRpcClient(
            clientAdapter.channel,
        );

        client.cancelInteraction("id-1");
        void client.cancelCommand("req-1");

        const cancelInteractionMsgs = sentMessages.filter(
            (m) => m.name === "cancelInteraction",
        );
        const cancelCommandMsgs = sentMessages.filter(
            (m) => m.name === "cancelCommand",
        );
        // cancelInteraction stays as call (fire-and-forget).
        for (const m of cancelInteractionMsgs) {
            expect(m.type).toBe("call");
        }
        // cancelCommand is now invoke (returns CancelResult).
        expect(cancelCommandMsgs.length).toBeGreaterThan(0);
        const clientCancelCmd = cancelCommandMsgs.find(
            (m) => m.type !== "callResult",
        );
        expect(clientCancelCmd?.type).toBe("invoke");
    });

    it("respondToInteraction uses an invoke message (expects reply)", async () => {
        const sentMessages: { type: string; name?: string }[] = [];

        let serverNotify: ((m: any) => void) | undefined;
        let clientNotify: ((m: any) => void) | undefined;

        const serverAdapter = createChannelAdapter((msg, cb) => {
            sentMessages.push({ type: msg.type, name: msg.name });
            clientNotify?.(msg);
            cb?.(null);
        });
        const clientAdapter = createChannelAdapter((msg, cb) => {
            sentMessages.push({ type: msg.type, name: msg.name });
            serverNotify?.(msg);
            cb?.(null);
        });

        serverNotify = serverAdapter.notifyMessage;
        clientNotify = clientAdapter.notifyMessage;

        createDispatcherRpcServer(makeStubDispatcher(), serverAdapter.channel);
        const { dispatcher: client } = createDispatcherRpcClient(
            clientAdapter.channel,
        );

        await client.respondToInteraction(makeResponse());

        const invokeMsg = sentMessages.find(
            (m) => m.name === "respondToInteraction",
        );
        expect(invokeMsg?.type).toBe("invoke");

        // Server should have replied with invokeResult
        const resultMsg = sentMessages.find((m) => m.type === "invokeResult");
        expect(resultMsg).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Completion-correlation map — covers the race between the submitCommand
// RPC reply (which carries the queue ack) and the `commandComplete` /
// `requestCancelled` ClientIO push events (which resolve / reject the
// synthesized `completion` promise on the client side).
//
// The wire-side server returns only {ok, entry} (no `completion` — promises
// can't cross RPC). The client wrapper synthesizes a fresh completion via
// dispatcherClient.attachCompletion. These tests exercise the four states
// of that machinery:
//   - ack arrives first, then completion notification (the normal case)
//   - completion notification arrives first, then ack (settledEarly path)
//   - requestCancelled with reason "server_stopping" rejects via ServerStoppingError
//   - close() drains outstanding pending awaiters so callers don't hang
// ---------------------------------------------------------------------------

function makeQueuedRequest(requestId: string): QueuedRequest {
    return {
        requestId,
        originatorConnectionId: "test-conn",
        text: "hello",
        submittedAt: 1,
        state: "succeeded",
    };
}

/**
 * Build a stub whose `submitCommand` resolves with a known requestId. If
 * `gate` is provided, the stub awaits it before returning — the test can
 * fire correlation events on the client side while the server is blocked.
 */
function stubWithSubmit(requestId: string, gate?: Promise<void>): Dispatcher {
    return makeStubDispatcher({
        submitCommand: (async () => {
            if (gate !== undefined) await gate;
            const result: SubmitResult = {
                ok: true,
                entry: makeQueuedRequest(requestId),
                completion: Promise.resolve(undefined),
            };
            return result;
        }) as Dispatcher["submitCommand"],
    });
}

describe("dispatcher RPC — submitCommand completion correlation", () => {
    it("resolves completion when commandComplete arrives after the ack", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        createDispatcherRpcServer(stubWithSubmit("rid-1"), serverChannel);
        const { dispatcher: client, notifyCommandComplete } =
            createDispatcherRpcClient(clientChannel);

        const r = await client.submitCommand("hello");
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.entry.requestId).toBe("rid-1");

        const result: CommandResult = {};
        notifyCommandComplete("rid-1", result);

        await expect(r.completion).resolves.toEqual(result);
    });

    it("resolves completion when commandComplete arrives before the ack (settledEarly)", async () => {
        // Hold the server's submitCommand handler so we can fire the
        // correlation event while attachCompletion has not yet run on
        // the client side.
        let release!: () => void;
        const gate = new Promise<void>((res) => {
            release = res;
        });
        const { serverChannel, clientChannel } = createChannelPair();
        createDispatcherRpcServer(stubWithSubmit("rid-2", gate), serverChannel);
        const { dispatcher: client, notifyCommandComplete } =
            createDispatcherRpcClient(clientChannel);

        const submitP = client.submitCommand("hello");

        // Server is blocked → ack not yet sent → no pending entry on the
        // client → this lands in settledEarly.
        const result: CommandResult = { lastError: "early" };
        notifyCommandComplete("rid-2", result);

        // Now let the server respond; hydrate will consume settledEarly.
        release();
        const r = await submitP;
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        await expect(r.completion).resolves.toEqual(result);
    });

    it("rejects completion with ServerStoppingError on requestCancelled(server_stopping)", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        createDispatcherRpcServer(stubWithSubmit("rid-3"), serverChannel);
        const { dispatcher: client, notifyRequestCancelled } =
            createDispatcherRpcClient(clientChannel);

        const r = await client.submitCommand("hello");
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        notifyRequestCancelled("rid-3", "server_stopping");

        await expect(r.completion).rejects.toBeInstanceOf(ServerStoppingError);
    });

    it("resolves completion with {cancelled:true} on non-server_stopping cancellation", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        createDispatcherRpcServer(stubWithSubmit("rid-4"), serverChannel);
        const { dispatcher: client, notifyRequestCancelled } =
            createDispatcherRpcClient(clientChannel);

        const r = await client.submitCommand("hello");
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        notifyRequestCancelled("rid-4", "user");

        await expect(r.completion).resolves.toEqual({ cancelled: true });
    });

    it("close() drains pending awaiters so they reject instead of hanging", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const stub = makeStubDispatcher({
            submitCommand: (async () => {
                return {
                    ok: true,
                    entry: makeQueuedRequest("rid-5"),
                    completion: Promise.resolve(undefined),
                } as SubmitResult;
            }) as Dispatcher["submitCommand"],
            close: (async () => {}) as Dispatcher["close"],
        });
        createDispatcherRpcServer(stub, serverChannel);
        const { dispatcher: client } = createDispatcherRpcClient(clientChannel);

        const r = await client.submitCommand("hello");
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        // No commandComplete fired → completion is pending.
        await client.close();

        await expect(r.completion).rejects.toThrow(/Dispatcher closed/);
    });
});
