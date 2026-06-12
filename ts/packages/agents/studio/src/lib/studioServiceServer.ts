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
import type { StudioEvent } from "@typeagent/core/events";
import { createStudioInvokeHandlers } from "./studioRpcHandlers.js";

const debug = registerDebug("typeagent:studio:websocket");

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
     */
    public static start(
        resolveRuntime: StudioRuntimeResolver,
        port: number = 0,
    ): Promise<StudioServiceServer> {
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({
                host: "127.0.0.1",
                port,
                verifyClient: (info, cb) => {
                    const origin = info.req.headers.origin as
                        | string
                        | undefined;
                    if (isAllowedOrigin(origin)) {
                        cb(true);
                    } else {
                        debug(`Rejecting WS upgrade from origin ${origin}`);
                        cb(false, 403, "Origin not allowed");
                    }
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
        const channel = createWebSocketRpcChannel(socket);

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
            }),
        );
        pushEvent = (event: StudioEvent) => rpc.send("studioEvent", event);

        socket.on("close", () => {
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
        return this.server.clients.size;
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
