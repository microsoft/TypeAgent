// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Studio service **registry** relay — the agent-side endpoint plus the
 * client helpers a service uses to announce itself and a proxy/extension uses
 * to find it. See {@link "@typeagent/core/runtime".StudioRegistryInvokeFunctions}
 * for the protocol and the rationale (the registrar is read-only and the agent
 * doesn't spawn the service, so the agent hosts this tiny registry instead).
 *
 * Threat model: loopback-only + Origin allowlist, matching the rest of the
 * Studio surface. There is no capability token on the registry itself (there is
 * no shared secret to bootstrap one between independently-launched processes) —
 * a same-user local process is trusted, which is the accepted line for the
 * whole "loopback + token" model.
 */

import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "node:net";
import registerDebug from "debug";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createAgentOriginAllowlist } from "websocket-utils/originAllowlist";
import { discoverPort } from "@typeagent/agent-server-client/discovery";
import {
    STUDIO_REGISTRY_ROLE,
    STUDIO_REGISTRY_PROTOCOL_VERSION,
    studioWorkspaceKey,
    isValidStudioServiceTokenFormat,
    type StudioRegistryInvokeFunctions,
    type StudioServiceEntry,
} from "@typeagent/core/runtime";
import { createWebSocketRpcChannel } from "./studioServiceServer.js";

const debug = registerDebug("typeagent:studio:registry");

const isAllowedOrigin = createAgentOriginAllowlist({
    extensionSchemes: ["vscode-webview://"],
});

/**
 * Validate an announcement before trusting it: structural sanity, a current
 * protocol version, and — crucially — that `workspaceKey` actually derives from
 * the announced `repoRoot`, so a service can only claim its own workspace.
 * (The registry is loopback + origin-gated but token-less, so this is the line
 * that keeps a malformed/incompatible announce out of the table.)
 */
function isValidAnnouncement(entry: StudioServiceEntry): boolean {
    return (
        entry !== null &&
        typeof entry === "object" &&
        Number.isInteger(entry.port) &&
        entry.port > 0 &&
        entry.port < 65536 &&
        typeof entry.token === "string" &&
        isValidStudioServiceTokenFormat(entry.token) &&
        entry.protocolVersion === STUDIO_REGISTRY_PROTOCOL_VERSION &&
        typeof entry.repoRoot === "string" &&
        entry.repoRoot.length > 0 &&
        entry.workspaceKey === studioWorkspaceKey(entry.repoRoot)
    );
}

/**
 * The agent-hosted registry: tracks the live standalone Studio service per
 * canonical workspace. Each announced entry is owned by its announcing socket
 * and evicted when that socket closes, so liveness needs no PID/file probing.
 */
export class StudioRegistryServer {
    /** Live services keyed by workspace, tagged with the owning connection. */
    private readonly entries = new Map<
        string,
        { entry: StudioServiceEntry; ownerId: number }
    >();
    private nextConnectionId = 0;
    private connectionCount = 0;

    /**
     * Fired after {@link connectionCount} changes (connect/disconnect) with the
     * new total, so the agent lifecycle can surface it to `@system ports`. The
     * connections are services announcing + brief lookups — not runtime clients.
     */
    public onClientCountChanged?: (count: number) => void;

    private constructor(
        private readonly server: WebSocketServer,
        public readonly port: number,
    ) {
        this.server.on("connection", (socket) => this.onConnection(socket));
        debug(`StudioRegistryServer listening on 127.0.0.1:${port}`);
    }

    /**
     * Bind a registry server on `port` (0 = OS-assigned). Resolves after the
     * `listening` event (so `port` is readable); rejects on bind error.
     */
    public static start(port: number = 0): Promise<StudioRegistryServer> {
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({
                host: "127.0.0.1",
                port,
                verifyClient: (info, cb) => {
                    const origin = info.req.headers.origin as
                        | string
                        | undefined;
                    if (!isAllowedOrigin(origin)) {
                        debug(
                            `Rejecting registry upgrade from origin ${origin}`,
                        );
                        cb(false, 403, "Origin not allowed");
                        return;
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
                resolve(new StudioRegistryServer(server, bound.port));
            });
        });
    }

    private onConnection(socket: WebSocket): void {
        const connectionId = this.nextConnectionId++;
        this.connectionCount++;
        this.onClientCountChanged?.(this.connectionCount);
        const channel = createWebSocketRpcChannel(socket);
        const handlers: StudioRegistryInvokeFunctions = {
            announce: async (entry: StudioServiceEntry) => {
                if (!isValidAnnouncement(entry)) {
                    debug(
                        `rejecting invalid announce for ${entry?.workspaceKey} (port ${entry?.port}, v${entry?.protocolVersion})`,
                    );
                    throw new Error("invalid studio service announcement");
                }
                // Newest-wins: a re-announce (service restart) for the same
                // workspace replaces the prior entry and re-tags ownership.
                this.entries.set(entry.workspaceKey, {
                    entry,
                    ownerId: connectionId,
                });
                debug(
                    `announced workspace ${entry.workspaceKey} -> 127.0.0.1:${entry.port} (conn ${connectionId})`,
                );
            },
            lookup: async (workspaceKey: string) => {
                return this.entries.get(workspaceKey)?.entry ?? null;
            },
        };
        createRpc<
            Record<string, never>,
            Record<string, never>,
            StudioRegistryInvokeFunctions
        >("studio:registry", channel, handlers);

        socket.on("close", () => {
            this.connectionCount = Math.max(0, this.connectionCount - 1);
            this.onClientCountChanged?.(this.connectionCount);
            // Evict only entries this socket still owns (a later re-announce
            // from another connection may have taken over the key).
            for (const [key, value] of this.entries) {
                if (value.ownerId === connectionId) {
                    this.entries.delete(key);
                    debug(
                        `evicted workspace ${key} (conn ${connectionId} closed)`,
                    );
                }
            }
        });
    }

    /** Live entry count (diagnostics/tests). */
    public size(): number {
        return this.entries.size;
    }

    /** In-process lookup of the live service for `workspaceKey` (for the agent). */
    public lookup(workspaceKey: string): StudioServiceEntry | undefined {
        return this.entries.get(workspaceKey)?.entry;
    }

    /** All live services (diagnostics / single-service fallback). */
    public list(): StudioServiceEntry[] {
        return [...this.entries.values()].map((v) => v.entry);
    }

    /** Open registry connections (services + lookups) — for `@system ports`. */
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

/** Where to reach the registry and how long to wait. */
export interface RegistryClientOptions {
    /** Explicit `ws://host:port` of the registry (tests); bypasses discovery. */
    endpoint?: string;
    /** Agent-server discovery URL (defaults to the agent-server default). */
    agentServerUrl?: string;
}

/**
 * Resolve the agent's registry endpoint via the agent-server port registrar,
 * or `undefined` when the agent-server is down / the studio agent isn't enabled.
 */
export async function discoverRegistryEndpoint(
    options: RegistryClientOptions = {},
): Promise<string | undefined> {
    if (options.endpoint !== undefined) {
        return options.endpoint;
    }
    const result = await discoverPort(
        "studio",
        STUDIO_REGISTRY_ROLE,
        options.agentServerUrl !== undefined
            ? { url: options.agentServerUrl }
            : undefined,
    );
    return result.kind === "found"
        ? `ws://127.0.0.1:${result.port}`
        : undefined;
}

/** Open a plain (token-less) registry socket, or resolve `undefined` on failure. */
function openRegistrySocket(endpoint: string): Promise<WebSocket | undefined> {
    return new Promise((resolve) => {
        const socket = new WebSocket(endpoint);
        let settled = false;
        const settle = (value: WebSocket | undefined) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        socket.once("open", () => settle(socket));
        socket.once("error", () => {
            try {
                socket.terminate();
            } catch {
                // Already closed.
            }
            settle(undefined);
        });
    });
}

/** Look up the live service for `workspaceKey` (short-lived connection). */
export async function lookupStudioService(
    workspaceKey: string,
    options: RegistryClientOptions = {},
): Promise<StudioServiceEntry | null> {
    const endpoint = await discoverRegistryEndpoint(options);
    if (endpoint === undefined) {
        return null;
    }
    const socket = await openRegistrySocket(endpoint);
    if (socket === undefined) {
        return null;
    }
    try {
        const rpc = createRpc<StudioRegistryInvokeFunctions>(
            "studio:registry:client",
            createWebSocketRpcChannel(socket),
        );
        return await rpc.invoke("lookup", workspaceKey);
    } catch {
        return null;
    } finally {
        socket.close();
    }
}

/** A live self-announcement; close to stop announcing (evicts the entry). */
export interface StudioServiceAnnouncement {
    close(): void;
}

/**
 * Keep `entry` announced to the registry for as long as the returned handle is
 * open: connect, announce, and on any drop reconnect (with backoff) and
 * re-announce. The agent evicts the entry when our socket closes, so a clean
 * {@link StudioServiceAnnouncement.close} (or process exit) deregisters us.
 *
 * Resolves once the first announce succeeds, or after `firstAttemptTimeoutMs`
 * (default 5 s) so a service start isn't blocked by a not-yet-running agent —
 * it keeps retrying in the background either way.
 */
export async function announceStudioService(
    entry: StudioServiceEntry,
    options: RegistryClientOptions & {
        backoffMs?: number[];
        firstAttemptTimeoutMs?: number;
    } = {},
): Promise<StudioServiceAnnouncement> {
    const backoffMs = options.backoffMs ?? [1000, 2000, 4000, 8000];
    let closed = false;
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let resolveFirst: (() => void) | undefined;
    const firstAnnounced = new Promise<void>((r) => (resolveFirst = r));

    const scheduleRetry = () => {
        if (closed || retryTimer !== undefined) return;
        const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
        attempt++;
        retryTimer = setTimeout(() => {
            retryTimer = undefined;
            void connect();
        }, delay);
        // Never let a pending reconnect keep the process (or a test) alive.
        retryTimer.unref?.();
    };

    const connect = async (): Promise<void> => {
        if (closed) return;
        const endpoint = await discoverRegistryEndpoint(options);
        if (closed) return;
        if (endpoint === undefined) {
            scheduleRetry();
            return;
        }
        const s = await openRegistrySocket(endpoint);
        if (closed) {
            s?.close();
            return;
        }
        if (s === undefined) {
            scheduleRetry();
            return;
        }
        socket = s;
        s.on("close", () => {
            if (socket === s) {
                socket = undefined;
            }
            if (!closed) {
                scheduleRetry();
            }
        });
        try {
            const rpc = createRpc<StudioRegistryInvokeFunctions>(
                "studio:registry:announcer",
                createWebSocketRpcChannel(s),
            );
            await rpc.invoke("announce", entry);
            attempt = 0;
            resolveFirst?.();
            debug(
                `announced workspace ${entry.workspaceKey} to registry ${endpoint}`,
            );
        } catch {
            try {
                s.terminate();
            } catch {
                // Already closed.
            }
            // The close handler above schedules the retry.
        }
    };

    void connect();

    const timeoutMs = options.firstAttemptTimeoutMs ?? 5000;
    await Promise.race([
        firstAnnounced,
        new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ]);

    return {
        close: () => {
            closed = true;
            if (retryTimer !== undefined) {
                clearTimeout(retryTimer);
                retryTimer = undefined;
            }
            socket?.close();
            socket = undefined;
        },
    };
}
