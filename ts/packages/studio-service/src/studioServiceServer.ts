// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "node:net";
import registerDebug from "debug";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import { createAgentOriginAllowlist } from "websocket-utils/originAllowlist";
import type {
    StudioRuntime,
    StudioClientCallFunctions,
    StudioServiceInvokeFunctions,
} from "@typeagent/core/runtime";
import { studioServiceTokenMatches } from "@typeagent/core/runtime";
import type { StudioEvent } from "@typeagent/core/events";
import { createStudioInvokeHandlers } from "./studioRpcHandlers.js";

const debug = registerDebug("typeagent:studio:websocket");

/**
 * Per-connection live-event backpressure: if the socket's outbound buffer grows
 * past this many bytes (slow/stuck client), drop further live events rather than
 * queue them unboundedly. The event log is best-effort "recent activity" and the
 * client can recover the full picture via `queryRecentEvents` on refresh.
 */
const BACKPRESSURE_BYTES = 1024 * 1024;

// Loopback web clients (the VS Code extension host connects as a Node `ws`
// client and sends no Origin, which is allowed; the webview origin is allowed
// defensively).
const isAllowedOrigin = createAgentOriginAllowlist({
    extensionSchemes: ["vscode-webview://"],
});

/** How the server resolves the per-workspace runtime for a request. */
export type StudioRuntimeResolver = (repoRoot?: string) => StudioRuntime;

/**
 * The `studio` agent's own WebSocket server — the rich-client transport (the
 * `code`↔`coda` pattern). Each client connection gets its own `agent-rpc`
 * endpoint exposing the typed Studio service methods (repo-scoped per request)
 * and a server→client event push. Binds to loopback only.
 */
export class StudioServiceServer {
    // Deterministic connect/disconnect counter (incremented on connection,
    // decremented on close) so the count reported to `@system ports` never
    // depends on `ws`'s internal client-set mutation timing.
    private connectionCount = 0;

    /**
     * Fired after {@link connectionCount} is mutated for any connect /
     * disconnect, with the post-mutation total. The lifecycle uses this to
     * push counts up via `SessionContext.notifyClientCountChanged` so
     * `@system ports` can surface them. NOTE: this server has no per-session
     * client identity, so the count is global across every session sharing
     * the bound port — not per-session.
     */
    public onClientCountChanged?: (count: number) => void;

    private constructor(
        private readonly server: WebSocketServer,
        public readonly port: number,
        private readonly resolveRuntime: StudioRuntimeResolver,
    ) {
        this.server.on("connection", (socket) => this.onConnection(socket));
        debug(`StudioServiceServer listening on 127.0.0.1:${port}`);
    }

    /**
     * Bind a new server on `port` (0 = OS-assigned). Resolves only after the
     * `listening` event so callers can read {@link port}; rejects on bind error.
     *
     * `expectedToken`, when provided, gates every upgrade: the client must send
     * `Authorization: Bearer <token>` matching it (checked alongside the Origin
     * allowlist). Pass `undefined` to skip the token check (in-process tests).
     */
    public static start(
        resolveRuntime: StudioRuntimeResolver,
        port: number = 0,
        expectedToken?: string,
    ): Promise<StudioServiceServer> {
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({
                host: "127.0.0.1",
                port,
                verifyClient: (info, cb) => {
                    const origin = info.req.headers.origin as
                        | string
                        | undefined;
                    if (!isAllowedOrigin(origin)) {
                        debug(`Rejecting WS upgrade from origin ${origin}`);
                        cb(false, 403, "Origin not allowed");
                        return;
                    }
                    if (expectedToken !== undefined) {
                        const presented = parseBearerToken(
                            info.req.headers.authorization,
                        );
                        if (
                            !studioServiceTokenMatches(presented, expectedToken)
                        ) {
                            // Generic 401: don't distinguish missing vs wrong.
                            debug("Rejecting WS upgrade: bad capability token");
                            cb(false, 401, "Unauthorized");
                            return;
                        }
                    }
                    cb(true);
                },
            });
            let settled = false;
            server.on("error", (error) => {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            });
            server.on("listening", () => {
                if (settled) return;
                settled = true;
                const bound = server.address() as AddressInfo;
                resolve(
                    new StudioServiceServer(server, bound.port, resolveRuntime),
                );
            });
        });
    }

    private onConnection(socket: WebSocket): void {
        const disposables: { dispose(): void }[] = [];
        // This connection's single live-event subscription (idempotent
        // subscribe / cancellation); owned here, never added to `disposables`.
        let eventSubscription: { dispose(): void } | undefined;
        let droppedEvents = 0;
        const channel = createWebSocketRpcChannel(socket);

        this.connectionCount++;
        this.onClientCountChanged?.(this.connectionCount);

        // `pushEvent` is wired after `rpc` exists (the handler closure must not
        // reference `rpc` inside its own initializer). It's only ever called
        // later, when the client invokes `subscribeEvents`.
        let pushEvent: (event: StudioEvent) => void = () => {};

        // Bidirectional rpc: client invokes StudioServiceInvokeFunctions; the
        // server pushes StudioClientCallFunctions (studioEvent) to the client.
        const rpc = createRpc<
            Record<string, never>,
            StudioClientCallFunctions,
            StudioServiceInvokeFunctions
        >(
            "studio:service",
            channel,
            createStudioInvokeHandlers({
                getRuntime: this.resolveRuntime,
                pushEvent: (event: StudioEvent) => pushEvent(event),
                addDisposable: (d) => disposables.push(d),
                setEventSubscription: (d) => {
                    // Replace (idempotent subscribe) / clear (cancellation).
                    eventSubscription?.dispose();
                    eventSubscription = d;
                },
            }),
        );
        pushEvent = (event: StudioEvent) => {
            if (socket.readyState !== WebSocket.OPEN) {
                return;
            }
            // Backpressure: under a slow/stuck client, drop rather than queue
            // unboundedly (recoverable via queryRecentEvents on refresh).
            if (socket.bufferedAmount > BACKPRESSURE_BYTES) {
                droppedEvents++;
                return;
            }
            rpc.send("studioEvent", event);
        };

        socket.on("close", () => {
            this.connectionCount = Math.max(0, this.connectionCount - 1);
            this.onClientCountChanged?.(this.connectionCount);
            if (droppedEvents > 0) {
                debug(
                    `connection closed after dropping ${droppedEvents} live event(s) under backpressure`,
                );
            }
            eventSubscription?.dispose();
            eventSubscription = undefined;
            for (const d of disposables.splice(0)) {
                try {
                    d.dispose();
                } catch (e) {
                    debug(`Error disposing subscription: ${e}`);
                }
            }
        });
    }

    public getConnectedCount(): number {
        return this.connectionCount;
    }

    public close(): Promise<void> {
        return new Promise((resolve) => {
            for (const client of this.server.clients) {
                client.terminate();
            }
            this.server.close(() => resolve());
        });
    }
}

/** Extract the token from an `Authorization: Bearer <token>` header, if present. */
function parseBearerToken(
    header: string | string[] | undefined,
): string | undefined {
    if (typeof header !== "string") {
        return undefined; // missing, or duplicated (string[]) — reject
    }
    const match = /^Bearer (\S+)$/.exec(header);
    return match ? match[1] : undefined;
}

/** Adapt a `ws` WebSocket to the `agent-rpc` {@link RpcChannel} interface. */
export function createWebSocketRpcChannel(socket: WebSocket): RpcChannel {
    const messageHandlers = new Set<(message: any) => void>();
    const disconnectHandlers = new Set<() => void>();
    const onceMessage = new Set<(message: any) => void>();
    const onceDisconnect = new Set<() => void>();

    socket.on("message", (data) => {
        let message: unknown;
        try {
            message = JSON.parse(data.toString());
        } catch {
            return; // ignore non-JSON frames
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
