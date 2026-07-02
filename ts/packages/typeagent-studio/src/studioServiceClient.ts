// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import { attachClientHeartbeat } from "@typeagent/websocket-utils/heartbeat";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createWebSocketRpcChannel } from "@typeagent/websocket-utils/rpcChannel";
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
import type {
    StudioEvent,
    CollisionDetectedEvent,
} from "@typeagent/core/events";
import type { CollisionFilter } from "@typeagent/core/collisions";
import type { CorpusEntry, ExternalSourceSpec } from "@typeagent/core/corpus";
import type { FeedbackRecordInput } from "@typeagent/core/feedback";
import type { SandboxStatus } from "@typeagent/core/sandbox";

/**
 * Client for the standalone Studio service's typed channel (the rich-client side
 * of the `code`↔`coda` pattern). Connects to a service endpoint supplied by the
 * launcher (which discovers/attaches the per-workspace service via the registry)
 * and exposes the typed Studio service methods + an event subscription over
 * `agent-rpc`.
 *
 * Every call is repo-scoped: pass the workspace `repoRoot` so the service selects
 * the right per-workspace runtime (the extension knows its workspace).
 */
export class StudioServiceClient {
    private constructor(
        private socket: WebSocket,
        private readonly rpc: ReturnType<
            typeof createRpc<StudioServiceInvokeFunctions>
        >,
        private readonly repoRoot: string | undefined,
        private readonly endpoint: string,
        private readonly token: string | undefined,
        /** Resolved heartbeat period; re-applied on every reconnect. `0` off. */
        private readonly heartbeatMs: number,
    ) {}

    /**
     * Connect to the Studio service at `endpoint`, presenting `token` as the
     * capability bearer. Returns `undefined` when no `endpoint` is supplied (the
     * launcher hasn't resolved the service yet) or the socket can't be opened
     * (service gone / bad token) — the caller surfaces a "not connected" state
     * and may retry. There is no discovery fallback: the service runs standalone
     * and is reached only via the launcher/registry-resolved `{endpoint, token}`.
     */
    static async connect(options: {
        repoRoot?: string;
        onEvent?: (event: StudioEvent) => void;
        /**
         * Invoked once when the underlying socket closes (service stopped,
         * network drop). Lets a client fall back instead of silently treating a
         * dead connection as "no events".
         */
        onClose?: () => void;
        /** The service `ws://host:port`, resolved by the launcher/registry. */
        endpoint?: string;
        /** Capability token presented as `Authorization: Bearer`. */
        token?: string;
        /**
         * Liveness-heartbeat period in ms (default 10s). The client pings the
         * service every period and terminates the socket if a pong hasn't
         * arrived since the previous ping — so a silently-dropped service (an
         * abrupt kill, a crash, or a half-open socket that never emits `close`)
         * is detected instead of leaving a stale "connected" state. `0`
         * disables the heartbeat. Exposed for tests.
         */
        heartbeatMs?: number;
    }): Promise<StudioServiceClient | undefined> {
        if (options.endpoint === undefined) {
            return undefined;
        }
        const attempt = await StudioServiceClient.openSocket(
            options.endpoint,
            options.token,
        );
        if (attempt.socket === undefined) {
            return undefined;
        }
        const socket = attempt.socket;
        if (options.onClose) {
            socket.on("close", options.onClose);
        }
        const heartbeatMs = options.heartbeatMs ?? 10_000;
        attachClientHeartbeat(socket, { intervalMs: heartbeatMs });
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
            { rebindable: true },
        );
        return new StudioServiceClient(
            socket,
            rpc,
            options.repoRoot,
            options.endpoint,
            options.token,
            heartbeatMs,
        );
    }

    /**
     * Reopen the service socket and rebind the existing rpc onto it, so this
     * client (and its rpc reference) survives a reconnect instead of being
     * recreated. `onClose` is wired to the new socket. Returns false when the
     * socket can't be reopened (service gone / bad token) — caller retries.
     */
    async reconnect(onClose: () => void): Promise<boolean> {
        const attempt = await StudioServiceClient.openSocket(
            this.endpoint,
            this.token,
        );
        if (attempt.socket === undefined) {
            return false;
        }
        const socket = attempt.socket;
        socket.on("close", onClose);
        // Re-arm liveness on the fresh socket: without this the ping/pong
        // watchdog would exist only for the first socket, so every reconnect
        // after the first drop would again be unable to detect a silently
        // half-open peer — the exact stale-"connected" failure the heartbeat
        // was added to fix. The previous socket's heartbeat self-stops on its
        // own `close`, so this re-attaches rather than leaks.
        attachClientHeartbeat(socket, { intervalMs: this.heartbeatMs });
        this.rpc.rebind(createWebSocketRpcChannel(socket));
        this.socket = socket;
        return true;
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
            const settle = (result: {
                socket?: WebSocket;
                status?: number;
            }) => {
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

    /** Federated corpus entries for an agent (Corpus tree expansion). */
    listCorpusEntries(agent: string): Promise<CorpusEntry[]> {
        return this.rpc.invoke("listCorpusEntries", this.repoRoot, agent);
    }

    /** Ensure an agent's in-repo corpus file exists; returns path + created. */
    seedInRepoCorpus(
        agent: string,
    ): Promise<{ path: string; created: boolean }> {
        return this.rpc.invoke("seedInRepoCorpus", this.repoRoot, agent);
    }

    /** Register an external JSONL corpus source for an agent. */
    addExternalCorpusSource(spec: ExternalSourceSpec): Promise<void> {
        return this.rpc.invoke("addExternalCorpusSource", this.repoRoot, spec);
    }

    /** Record a thumbs-up/down feedback row. */
    recordFeedback(input: FeedbackRecordInput): Promise<void> {
        return this.rpc.invoke("recordFeedback", this.repoRoot, input);
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
export { createWebSocketRpcChannel };
