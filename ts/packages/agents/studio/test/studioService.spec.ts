// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import type {
    StudioRuntime,
    StudioServiceInvokeFunctions,
    StudioClientCallFunctions,
    StudioInfo,
} from "@typeagent/core/runtime";
import type { StudioEvent } from "@typeagent/core/events";
import { createStudioInvokeHandlers } from "../src/lib/studioRpcHandlers.js";

/**
 * A pair of in-memory RpcChannels wired to each other. Delivery is async
 * (queueMicrotask) because `createRpc.invoke` sends *before* registering the
 * pending call — a synchronous channel would deliver the response first and
 * trip "Invalid callId".
 */
function createChannelPair(): [RpcChannel, RpcChannel] {
    const make = () => {
        const handlers = new Set<(m: any) => void>();
        const onceHandlers = new Set<(m: any) => void>();
        let peer: { deliver(m: any): void };
        const channel: RpcChannel & { deliver(m: any): void } = {
            on: (event, cb: any) => {
                if (event === "message") handlers.add(cb);
            },
            once: (event, cb: any) => {
                if (event === "message") onceHandlers.add(cb);
            },
            off: (event, cb: any) => {
                if (event === "message") handlers.delete(cb);
            },
            send: (message, cb) => {
                // Round-trip through JSON to faithfully reproduce the real WS
                // transport (notably: `undefined` args arrive as `null`).
                const wire = JSON.parse(JSON.stringify(message));
                queueMicrotask(() => peer.deliver(wire));
                cb?.(null);
            },
            deliver: (message) => {
                for (const h of handlers) h(message);
                for (const h of onceHandlers.values()) {
                    onceHandlers.delete(h);
                    h(message);
                }
            },
        };
        return {
            channel,
            setPeer: (p: { deliver(m: any): void }) => (peer = p),
        };
    };
    const a = make();
    const b = make();
    a.setPeer(b.channel);
    b.setPeer(a.channel);
    return [a.channel, b.channel];
}

/** Minimal StudioRuntime stub exposing only what the handlers touch. */
function createRuntimeStub(): {
    runtime: StudioRuntime;
    fireEvent(event: StudioEvent): void;
} {
    const listeners = new Set<(e: StudioEvent) => void>();
    const runtime = {
        getRepoRootInfo: () => ({
            repoRoot: "/repo/ts",
            agentsDirFound: true,
        }),
        getAgentLocations: async () => [
            { root: "/repo/ts/packages/agents", exists: true, agentCount: 2 },
        ],
        listCollisions: async () => [],
        queryRecentEvents: async () => [],
        onAnyEvent: (listener: (e: StudioEvent) => void) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
    } as unknown as StudioRuntime;
    return {
        runtime,
        fireEvent: (event) => listeners.forEach((l) => l(event)),
    };
}

function wireClientServer(stub: { runtime: StudioRuntime }) {
    const [clientChannel, serverChannel] = createChannelPair();
    const received: StudioEvent[] = [];
    const disposables: { dispose(): void }[] = [];
    // Mirror the real server: a single owned event subscription per connection.
    let eventSubscription: { dispose(): void } | undefined;
    let pushEvent: (e: StudioEvent) => void = () => {};

    const server = createRpc<
        Record<string, never>,
        StudioClientCallFunctions,
        StudioServiceInvokeFunctions
    >(
        "test:server",
        serverChannel,
        createStudioInvokeHandlers({
            getRuntime: () => stub.runtime,
            pushEvent: (e) => pushEvent(e),
            addDisposable: (d) => disposables.push(d),
            setEventSubscription: (d) => {
                eventSubscription?.dispose();
                eventSubscription = d;
            },
        }),
    );
    pushEvent = (e) => server.send("studioEvent", e);

    const client = createRpc<
        StudioServiceInvokeFunctions,
        Record<string, never>,
        Record<string, never>,
        StudioClientCallFunctions
    >("test:client", clientChannel, undefined, {
        studioEvent: (e: StudioEvent) => received.push(e),
    });

    return { client, received, disposables };
}

describe("studio service channel (in-memory rpc)", () => {
    it("getStudioInfo round-trips repo info + agent locations", async () => {
        const stub = createRuntimeStub();
        const { client } = wireClientServer(stub);
        const info: StudioInfo = await client.invoke(
            "getStudioInfo",
            undefined,
        );
        expect(info.repoRootInfo.repoRoot).toBe("/repo/ts");
        expect(info.agentLocations).toHaveLength(1);
        expect(info.agentLocations[0].agentCount).toBe(2);
    });

    it("listCollisions and queryRecentEvents round-trip", async () => {
        const stub = createRuntimeStub();
        const { client } = wireClientServer(stub);
        expect(await client.invoke("listCollisions", undefined)).toEqual([]);
        expect(await client.invoke("queryRecentEvents", undefined, 5)).toEqual(
            [],
        );
    });

    it("subscribeEvents pushes live events to the client", async () => {
        const stub = createRuntimeStub();
        const { client, received } = wireClientServer(stub);
        await client.invoke("subscribeEvents", undefined);
        stub.fireEvent({ type: "collision.detected", ts: 1 } as StudioEvent);
        // let the async channel deliver the server→client push
        await new Promise((r) => setTimeout(r, 0));
        expect(received).toHaveLength(1);
        expect(received[0].type).toBe("collision.detected");
    });

    it("subscribeEvents is idempotent — a second call doesn't duplicate pushes", async () => {
        const stub = createRuntimeStub();
        const { client, received } = wireClientServer(stub);
        await client.invoke("subscribeEvents", undefined);
        await client.invoke("subscribeEvents", undefined);
        stub.fireEvent({ type: "collision.detected", ts: 1 } as StudioEvent);
        await new Promise((r) => setTimeout(r, 0));
        // One event in → exactly one push out (no stacked listeners).
        expect(received).toHaveLength(1);
    });

    it("unsubscribeEvents stops further pushes", async () => {
        const stub = createRuntimeStub();
        const { client, received } = wireClientServer(stub);
        await client.invoke("subscribeEvents", undefined);
        await client.invoke("unsubscribeEvents");
        stub.fireEvent({ type: "collision.detected", ts: 1 } as StudioEvent);
        await new Promise((r) => setTimeout(r, 0));
        expect(received).toHaveLength(0);
    });

    it("unsubscribeEvents is a no-op when not subscribed", async () => {
        const stub = createRuntimeStub();
        const { client } = wireClientServer(stub);
        await expect(
            client.invoke("unsubscribeEvents"),
        ).resolves.toBeUndefined();
    });
});
