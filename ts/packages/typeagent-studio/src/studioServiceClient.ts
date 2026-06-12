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
    StudioReplayRequest,
    StudioReplayResult,
    StudioCollisionScanRequest,
    StudioCollisionScanResult,
    AvailableAgent,
} from "@typeagent/core/runtime";
import { readStudioServiceToken } from "@typeagent/core/runtime";
import type {
    StudioEvent,
    CollisionDetectedEvent,
} from "@typeagent/core/events";
import type { CollisionFilter } from "@typeagent/core/collisions";
import type { SandboxStatus } from "@typeagent/core/sandbox";

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
        /**
         * Invoked once when the underlying socket closes (agent-server stopped,
         * studio agent disabled, network drop). Lets a client fall back instead
         * of silently treating a dead connection as "no events".
         */
        onClose?: () => void;
        /** Override discovery with an explicit `ws://host:port` (tests). */
        endpoint?: string;
        /**
         * Explicit capability token (tests). On the real discovery path the
         * token is read from the per-port token file the agent published.
         */
        token?: string;
        /** Where to reach the agent-server discovery channel. */
        agentServerUrl?: string;
    }): Promise<StudioServiceClient | undefined> {
        let endpoint = options.endpoint;
        let token = options.token;
        let port: number | undefined;
        if (endpoint === undefined) {
            // Discovery path: resolve the port, then read its capability token.
            const result = await discoverPort(
                "studio",
                undefined,
                options.agentServerUrl !== undefined
                    ? { url: options.agentServerUrl }
                    : undefined,
            );
            if (result.kind !== "found") {
                return undefined;
            }
            port = result.port;
            endpoint = `ws://127.0.0.1:${port}`;
            if (token === undefined) {
                token = await readStudioServiceToken(port);
            }
        }

        let attempt = await StudioServiceClient.openSocket(endpoint, token);
        // A 401 on the discovery path most likely means a stale token (the
        // agent restarted between discovery and connect). Re-read once and retry
        // — distinct from "service not found" (discovery already succeeded).
        if (
            attempt.socket === undefined &&
            attempt.status === 401 &&
            port !== undefined &&
            options.token === undefined
        ) {
            token = await readStudioServiceToken(port);
            attempt = await StudioServiceClient.openSocket(endpoint, token);
        }
        if (attempt.socket === undefined) {
            return undefined;
        }
        const socket = attempt.socket;
        if (options.onClose) {
            socket.on("close", options.onClose);
        }
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

    /**
     * Open a socket, sending the capability token as an
     * `Authorization: Bearer` header when present. Resolves with the open socket
     * or, on failure, the HTTP status of a rejected upgrade (e.g. 401/403) when
     * one was reported — never rejects, so callers stay graceful.
     */
    private static openSocket(
        endpoint: string,
        token: string | undefined,
    ): Promise<{ socket?: WebSocket; status?: number }> {
        return new Promise((resolve) => {
            const socket = new WebSocket(
                endpoint,
                token !== undefined
                    ? { headers: { Authorization: `Bearer ${token}` } }
                    : undefined,
            );
            let settled = false;
            const settle = (result: { socket?: WebSocket; status?: number }) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };
            // Attaching an `unexpected-response` listener suppresses `ws`'s
            // automatic error emit, so we must settle from here on a rejected
            // upgrade (e.g. 401 from the capability-token check) and tear the
            // socket down ourselves.
            socket.once(
                "unexpected-response",
                (_req: unknown, res: { statusCode?: number }) => {
                    const status = res.statusCode;
                    try {
                        socket.terminate();
                    } catch {
                        // Already closed.
                    }
                    settle(status !== undefined ? { status } : {});
                },
            );
            socket.once("open", () => settle({ socket }));
            socket.once("error", () => {
                try {
                    socket.terminate();
                } catch {
                    // Already closed.
                }
                settle({});
            });
        });
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

    /** Scan compiled grammars for collisions (read-only analysis). */
    scanGrammarCollisions(
        request?: StudioCollisionScanRequest,
    ): Promise<StudioCollisionScanResult> {
        return this.rpc.invoke("scanGrammarCollisions", this.repoRoot, request);
    }

    /** Remove stored collisions matching `filter` (all when omitted). */
    clearCollisions(filter?: CollisionFilter): Promise<number> {
        return this.rpc.invoke("clearCollisions", this.repoRoot, filter);
    }

    queryRecentEvents(limit?: number): Promise<StudioEvent[]> {
        return this.rpc.invoke("queryRecentEvents", this.repoRoot, limit);
    }

    /** Corpus agents available for replay in this workspace. */
    listCorpusAgents(): Promise<string[]> {
        return this.rpc.invoke("listCorpusAgents", this.repoRoot);
    }

    /** Replay an agent's corpus comparing two versions (Impact Report data). */
    replayCorpus(request: StudioReplayRequest): Promise<StudioReplayResult> {
        return this.rpc.invoke("replayCorpus", this.repoRoot, request);
    }

    /** Start receiving live `studioEvent` pushes for this connection's repo. */
    subscribeEvents(): Promise<void> {
        return this.rpc.invoke("subscribeEvents", this.repoRoot);
    }

    /** Cancel this connection's live event subscription (idempotent). */
    unsubscribeEvents(): Promise<void> {
        return this.rpc.invoke("unsubscribeEvents");
    }

    // --- Sandbox lifecycle ---

    listSandboxes(): Promise<SandboxStatus[]> {
        return this.rpc.invoke("listSandboxes", this.repoRoot);
    }

    listAvailableAgents(): Promise<AvailableAgent[]> {
        return this.rpc.invoke("listAvailableAgents", this.repoRoot);
    }

    startSandbox(options?: {
        id?: string;
        agents?: string[];
    }): Promise<SandboxStatus> {
        return this.rpc.invoke("startSandbox", this.repoRoot, options);
    }

    stopSandbox(id: string): Promise<void> {
        return this.rpc.invoke("stopSandbox", this.repoRoot, id);
    }

    restartSandbox(id: string): Promise<void> {
        return this.rpc.invoke("restartSandbox", this.repoRoot, id);
    }

    loadSandboxAgent(id: string, agentRef: string): Promise<SandboxStatus> {
        return this.rpc.invoke("loadSandboxAgent", this.repoRoot, id, agentRef);
    }

    unloadSandboxAgent(id: string, agentName: string): Promise<SandboxStatus> {
        return this.rpc.invoke(
            "unloadSandboxAgent",
            this.repoRoot,
            id,
            agentName,
        );
    }

    refreshSandboxAgent(agentName: string): Promise<number> {
        return this.rpc.invoke("refreshSandboxAgent", this.repoRoot, agentName);
    }

    restoreSandboxes(): Promise<void> {
        return this.rpc.invoke("restoreSandboxes", this.repoRoot);
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
