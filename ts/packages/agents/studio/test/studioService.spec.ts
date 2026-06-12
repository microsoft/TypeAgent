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
        clearCollisions: async () => 0,
        scanGrammarCollisions: async () => ({
            scanned: ["player", "calendar"],
            skipped: [],
            collisionCount: 0,
        }),
        queryRecentEvents: async () => [],
        listCorpusAgents: async () => ["player", "calendar"],
        replayCorpus: async (request: { agent: string }) => ({
            runId: "run-1",
            summary: {
                runId: "run-1",
                agent: request.agent,
                versionA: { kind: "workingTree" },
                versionB: { kind: "workingTree" },
                corpusSize: 1,
                rowCount: 1,
                equalCount: 1,
                changedCount: 0,
                newMatchCount: 0,
                lostMatchCount: 0,
                collisionDelta: 0,
                duration: 5,
            },
            rows: [
                {
                    utterance: "play jazz",
                    source: "in-repo",
                    utteranceId: "u1",
                    equal: true,
                    cacheStateA: "hit",
                    cacheStateB: "hit",
                    collisionsA: [],
                    collisionsB: [],
                    latencyA: 1,
                    latencyB: 1,
                    requestIdA: "a",
                    requestIdB: "b",
                },
            ],
        }),
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

    it("scanGrammarCollisions and clearCollisions round-trip", async () => {
        const stub = createRuntimeStub();
        const { client } = wireClientServer(stub);
        const scan = await client.invoke("scanGrammarCollisions", undefined);
        expect(scan.scanned).toEqual(["player", "calendar"]);
        expect(scan.collisionCount).toBe(0);
        expect(await client.invoke("clearCollisions", undefined)).toBe(0);
    });

    it("listCorpusAgents and replayCorpus round-trip", async () => {
        const stub = createRuntimeStub();
        const { client } = wireClientServer(stub);
        expect(await client.invoke("listCorpusAgents", undefined)).toEqual([
            "player",
            "calendar",
        ]);
        const result = await client.invoke("replayCorpus", undefined, {
            agent: "player",
            missPolicy: "needs-explanation",
        });
        expect(result.runId).toBe("run-1");
        expect(result.summary.agent).toBe("player");
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].utterance).toBe("play jazz");
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
