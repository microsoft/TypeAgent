// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import { createDispatcherRpcClient } from "../src/dispatcherClient.js";
import { createDispatcherRpcServer } from "../src/dispatcherServer.js";
import type { Dispatcher } from "@typeagent/dispatcher-types";
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
        processCommand: notImplemented("processCommand") as any,
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
        cancelCommand(...args) {
            calls.push({ method: "cancelCommand", args });
        },
        async respondToInteraction(...args) {
            calls.push({ method: "respondToInteraction", args });
        },
        cancelInteraction(...args) {
            calls.push({ method: "cancelInteraction", args });
        },
        ...overrides,
        calls,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeResponse(interactionId = "id-1"): PendingInteractionResponse {
    return { interactionId, type: "askYesNo", value: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("dispatcher RPC — cancelInteraction (fire-and-forget)", () => {
    it("sends a call message and does not wait for a reply", () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const stub = makeStubDispatcher();
        createDispatcherRpcServer(stub, serverChannel);
        const client = createDispatcherRpcClient(clientChannel);

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
        const client = createDispatcherRpcClient(clientChannel);

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
        const client = createDispatcherRpcClient(clientChannel);

        const ret = client.cancelInteraction("no-reply");

        expect(ret).not.toBeInstanceOf(Promise);
    });
});

describe("dispatcher RPC — respondToInteraction (invoke / awaited)", () => {
    it("resolves after the server handler returns", async () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const stub = makeStubDispatcher();
        createDispatcherRpcServer(stub, serverChannel);
        const client = createDispatcherRpcClient(clientChannel);

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
        const client = createDispatcherRpcClient(clientChannel);

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
        const client = createDispatcherRpcClient(clientChannel);

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
        const client = createDispatcherRpcClient(clientChannel);

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

describe("dispatcher RPC — cancelCommand (existing fire-and-forget, regression)", () => {
    it("sends a call message and returns void synchronously", () => {
        const { serverChannel, clientChannel } = createChannelPair();
        const stub = makeStubDispatcher();
        createDispatcherRpcServer(stub, serverChannel);
        const client = createDispatcherRpcClient(clientChannel);

        const result = client.cancelCommand("req-1");

        expect(result).toBeUndefined();
        expect(stub.calls).toEqual([
            { method: "cancelCommand", args: ["req-1"] },
        ]);
    });
});

describe("dispatcher RPC — transport symmetry", () => {
    it("cancelInteraction and cancelCommand both use call messages (no invoke round-trip)", () => {
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
        const client = createDispatcherRpcClient(clientAdapter.channel);

        client.cancelInteraction("id-1");
        client.cancelCommand("req-1");

        // Both should produce "call" messages, not "invoke"
        const clientMessages = sentMessages.filter(
            (m) => m.name === "cancelInteraction" || m.name === "cancelCommand",
        );
        expect(clientMessages).toHaveLength(2);
        for (const m of clientMessages) {
            expect(m.type).toBe("call");
        }
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
        const client = createDispatcherRpcClient(clientAdapter.channel);

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
