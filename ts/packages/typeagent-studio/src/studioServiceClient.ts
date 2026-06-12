// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import { discoverPort } from "@typeagent/agent-server-client/discovery";
import type {
    StudioInfo,
    StudioServiceInvokeFunctions,
    StudioClientCallFunctions,
} from "@typeagent/core/runtime";
import type {
    StudioEvent,
    CollisionDetectedEvent,
} from "@typeagent/core/events";

/**
 * Client for the `studio` agent's typed service channel (the rich-client side of
 * the `code`↔`coda` pattern). Discovers the agent's WebSocket via the
 * agent-server `discovery` channel, connects, and exposes the typed Studio
 * service methods + an event subscription over `agent-rpc`.
 *
 * Every call is repo-scoped: pass the workspace `repoRoot` so the agent selects
 * the right per-workspace runtime (the extension knows its workspace; the agent
 * shouldn't guess).
 */
export class StudioServiceClient {
    private constructor(
        private readonly socket: WebSocket,
        private readonly rpc: ReturnType<
            typeof createRpc<StudioServiceInvokeFunctions>
        >,
        private readonly repoRoot: string | undefined,
    ) {}

    /**
     * Discover and connect to the `studio` service. Returns `undefined` when the
     * agent-server isn't running or the `studio` agent isn't enabled yet (the
     * caller should surface a "not connected" state and may retry).
     */
    static async connect(options: {
        repoRoot?: string;
        onEvent?: (event: StudioEvent) => void;
        /** Override discovery with an explicit `ws://host:port` (tests). */
        endpoint?: string;
        /** Where to reach the agent-server discovery channel. */
        agentServerUrl?: string;
    }): Promise<StudioServiceClient | undefined> {
        const endpoint =
            options.endpoint ??
            (await StudioServiceClient.discover(options.agentServerUrl));
        if (endpoint === undefined) {
            return undefined;
        }
        const socket = new WebSocket(endpoint);
        await new Promise<void>((resolve, reject) => {
            socket.once("open", () => resolve());
            socket.once("error", reject);
        });
        const callHandlers: StudioClientCallFunctions = {
            studioEvent: (event: StudioEvent) => options.onEvent?.(event),
        };
        const rpc = createRpc<
            StudioServiceInvokeFunctions,
            Record<string, never>,
            Record<string, never>,
            StudioClientCallFunctions
        >(
            "studio:client",
            createWebSocketRpcChannel(socket),
            undefined,
            callHandlers,
        );
        return new StudioServiceClient(socket, rpc, options.repoRoot);
    }

    /** Resolve the `studio` service endpoint via discovery, or `undefined`. */
    static async discover(
        agentServerUrl?: string,
    ): Promise<string | undefined> {
        const result = await discoverPort(
            "studio",
            undefined,
            agentServerUrl !== undefined ? { url: agentServerUrl } : undefined,
        );
        return result.kind === "found"
            ? `ws://127.0.0.1:${result.port}`
            : undefined;
    }

    getStudioInfo(): Promise<StudioInfo> {
        return this.rpc.invoke("getStudioInfo", this.repoRoot);
    }

    listCollisions(): Promise<CollisionDetectedEvent[]> {
        return this.rpc.invoke("listCollisions", this.repoRoot);
    }

    queryRecentEvents(limit?: number): Promise<StudioEvent[]> {
        return this.rpc.invoke("queryRecentEvents", this.repoRoot, limit);
    }

    /** Start receiving live `studioEvent` pushes for this connection's repo. */
    subscribeEvents(): Promise<void> {
        return this.rpc.invoke("subscribeEvents", this.repoRoot);
    }

    close(): void {
        this.socket.close();
    }
}

/** Adapt a `ws` WebSocket to the `agent-rpc` {@link RpcChannel} interface. */
export function createWebSocketRpcChannel(socket: WebSocket): RpcChannel {
    const messageHandlers = new Set<(message: any) => void>();
    const disconnectHandlers = new Set<() => void>();
    const onceMessage = new Set<(message: any) => void>();
    const onceDisconnect = new Set<() => void>();

    socket.on("message", (data: WebSocket.RawData) => {
        let message: unknown;
        try {
            message = JSON.parse(data.toString());
        } catch {
            return;
        }
        for (const h of messageHandlers) h(message);
        for (const h of onceMessage.values()) {
            onceMessage.delete(h);
            h(message);
        }
    });
    socket.on("close", () => {
        for (const h of disconnectHandlers) h();
        for (const h of onceDisconnect.values()) {
            onceDisconnect.delete(h);
            h();
        }
    });

    return {
        on(event: "message" | "disconnect", cb: any) {
            (event === "message" ? messageHandlers : disconnectHandlers).add(
                cb,
            );
        },
        once(event: "message" | "disconnect", cb: any) {
            (event === "message" ? onceMessage : onceDisconnect).add(cb);
        },
        off(event: "message" | "disconnect", cb: any) {
            (event === "message" ? messageHandlers : disconnectHandlers).delete(
                cb,
            );
        },
        send(message: unknown, cb?: (err: Error | null) => void) {
            socket.send(JSON.stringify(message), (err) => cb?.(err ?? null));
        },
    };
}
