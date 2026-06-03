// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: websocket-bridge — bidirectional RPC to a host-side plugin.
// The agent owns a WebSocketServer; the host plugin connects as the client.
// Commands flow TypeAgent → WebSocket → plugin → response.
//
// Port allocation: the bridge binds on an OS-assigned ephemeral port
// (port=0) by default. The actual port is registered with the dispatcher
// via context.registerPort("default", port) so external clients can
// discover it through the agent-server's discovery channel
// (discoverPort("__agentName__", "default")). Set __PORT_ENV__ to pin the
// bridge to a fixed port when debugging or when a host plugin expects
// a known address.
//
// Lifecycle: one bridge per process, refcounted across enabled sessions.
// Each enabled session registers the bridge under its own
// sessionContextId; lookup("__agentName__", "default") keeps returning the
// port as long as ≥1 session has the agent enabled. The dispatcher's
// closeSessionContext backstop releases stale per-session registrations
// if disable is skipped (e.g. crash).

import {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "net";
import { __AgentName__Actions } from "./__agentName__Schema.js";

function getBridgeBindPort(): number {
    const v = process.env["__PORT_ENV__"];
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ---- WebSocket bridge --------------------------------------------------

type BridgeRequest = { id: string; actionName: string; parameters: unknown };
type BridgeResponse = {
    id: string;
    success: boolean;
    result?: unknown;
    error?: string;
};

class __AgentName__Bridge {
    private clients = new Map<string, WebSocket>();
    private nextClientId = 0;
    private pending = new Map<
        string,
        {
            resolve: (result: unknown) => void;
            reject: (err: Error) => void;
        }
    >();

    // Construction is private — use {@link __AgentName__Bridge.start} so
    // callers always get a bridge that is guaranteed to be bound before
    // they read {@link port} or pass it to the registrar.
    private constructor(
        private readonly server: WebSocketServer,
        public readonly port: number,
    ) {
        this.server.on("connection", (ws) => {
            const id = `c-${++this.nextClientId}`;
            this.clients.set(id, ws);
            ws.on("message", (data) => {
                try {
                    const response = JSON.parse(
                        data.toString(),
                    ) as BridgeResponse;
                    const entry = this.pending.get(response.id);
                    if (entry) {
                        this.pending.delete(response.id);
                        if (response.success) entry.resolve(response.result);
                        else entry.reject(new Error(response.error));
                    }
                } catch {
                    // Ignore malformed payloads.
                }
            });
            // Reject any pending requests routed through the bridge when
            // the last connected client drops; without this, in-flight
            // callers hang until the bridge is closed.
            const onDisconnect = () => {
                this.clients.delete(id);
                if (this.clients.size === 0 && this.pending.size > 0) {
                    const err = new Error(
                        "Host plugin disconnected before responding.",
                    );
                    for (const entry of this.pending.values()) {
                        entry.reject(err);
                    }
                    this.pending.clear();
                }
            };
            ws.on("close", onDisconnect);
            ws.on("error", onDisconnect);
        });
    }

    /**
     * Bind a new bridge on `port`. Pass 0 (default) to let the OS pick a
     * free ephemeral port; read the actual bound port from {@link port}
     * after the returned promise resolves. Rejects on bind failure
     * (EADDRINUSE under a fixed-port override) so callers see the
     * problem instead of having it swallowed by a late error handler.
     */
    public static start(port: number = 0): Promise<__AgentName__Bridge> {
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({ port });
            let settled = false;
            const onError = (e: Error) => {
                if (settled) return;
                settled = true;
                server.removeListener("listening", onListening);
                reject(e);
            };
            const onListening = () => {
                if (settled) return;
                settled = true;
                server.removeListener("error", onError);
                const addr = server.address() as AddressInfo | null;
                if (!addr || typeof addr === "string") {
                    server.close();
                    reject(
                        new Error(
                            "ws server.address() did not return AddressInfo",
                        ),
                    );
                    return;
                }
                // Re-attach a permanent error handler so post-listen errors
                // are surfaced rather than crashing the process.
                server.on("error", (err) => {
                    console.error(
                        `[__agentName__Bridge] post-listen server error: ${err.message}`,
                    );
                });
                resolve(new __AgentName__Bridge(server, addr.port));
            };
            server.once("error", onError);
            server.once("listening", onListening);
        });
    }

    /**
     * Close all client connections and the underlying server. Pending
     * `send` promises are rejected so callers never hang on a closed
     * bridge. Resolves when the server has fully released its port —
     * important for a rapid disable→enable cycle under a fixed-port
     * override (`__PORT_ENV__`), where a synchronous return would race
     * the new bind into EADDRINUSE.
     */
    public close(): Promise<void> {
        const closedError = new Error(
            "__AgentName__Bridge closed before response was received.",
        );
        for (const entry of this.pending.values()) {
            entry.reject(closedError);
        }
        this.pending.clear();
        for (const c of this.clients.values()) {
            if (c.readyState === WebSocket.OPEN) c.close();
        }
        this.clients.clear();
        return new Promise((resolve) => this.server.close(() => resolve()));
    }

    public get connected(): boolean {
        for (const c of this.clients.values()) {
            if (c.readyState === WebSocket.OPEN) return true;
        }
        return false;
    }

    public async send(
        actionName: string,
        parameters: unknown,
    ): Promise<unknown> {
        // Use the first OPEN client (single-plugin pattern). Adapt this
        // selection if you need fan-out or per-session client targeting.
        let target: WebSocket | undefined;
        for (const c of this.clients.values()) {
            if (c.readyState === WebSocket.OPEN) {
                target = c;
                break;
            }
        }
        if (!target) {
            throw new Error(
                "No host plugin connected to the __agentName__ bridge.",
            );
        }
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            target!.send(
                JSON.stringify({
                    id,
                    actionName,
                    parameters,
                } satisfies BridgeRequest),
                (err) => {
                    // ws.send errors surface here; without this, a send
                    // failure (socket closed between readyState check and
                    // send) would leak the pending entry and hang the
                    // caller.
                    if (err) {
                        this.pending.delete(id);
                        reject(err);
                    }
                },
            );
        });
    }
}

// ---- Shared module state -----------------------------------------------
//
// Storing the bridge per-session would cause "no connection" errors when
// an action runs on a session different from the one that started the
// server, and would mask EADDRINUSE failures from a second bind under a
// fixed-port override. The shared-bridge + per-session-registration
// pattern matches the code and browser agents.

let sharedBridge: __AgentName__Bridge | undefined;
let sharedStartingPromise: Promise<__AgentName__Bridge> | undefined;
let sharedClosingPromise: Promise<void> | undefined;
let sharedRefCount = 0;

// Serialize concurrent starts; await any in-flight close before binding
// again so a rapid disable→enable doesn't race the port release.
async function ensureSharedBridge(): Promise<__AgentName__Bridge> {
    if (sharedClosingPromise !== undefined) {
        await sharedClosingPromise;
    }
    if (sharedBridge !== undefined) return sharedBridge;
    if (sharedStartingPromise !== undefined) return sharedStartingPromise;
    sharedStartingPromise = (async () => {
        try {
            sharedBridge = await __AgentName__Bridge.start(getBridgeBindPort());
            return sharedBridge;
        } finally {
            sharedStartingPromise = undefined;
        }
    })();
    return sharedStartingPromise;
}

// ---- Agent lifecycle ---------------------------------------------------

type __AgentName__Context = {
    enabledSchemas: Set<string>;
    portRegistration?: { release: () => void };
    // Serializes concurrent updateAgentContext / closeAgentContext calls
    // for this session so the (mutate set, await ensureSharedBridge,
    // register port, bump refcount) sequence is atomic. Without this,
    // an interleaved second enable could observe a non-empty set before
    // the first call registers, skip registration itself, and then the
    // first call rolling back on failure would leave the session
    // "enabled" with no registration — and a later disable would
    // decrement sharedRefCount it never incremented, tearing down the
    // bridge another session still depends on.
    pending?: Promise<void>;
};

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        closeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<__AgentName__Context> {
    return { enabledSchemas: new Set() };
}

// Chain `fn` after any in-flight operation for this session. Prior
// failures don't poison the chain (we swallow them when waiting), but
// the caller of `fn` still sees its own thrown error.
async function withSessionLock<T>(
    ctx: __AgentName__Context,
    fn: () => Promise<T>,
): Promise<T> {
    const prev = ctx.pending ?? Promise.resolve();
    let release!: () => void;
    ctx.pending = new Promise<void>((r) => (release = r));
    try {
        await prev.catch(() => {});
        return await fn();
    } finally {
        release();
    }
}

/**
 * Backstop cleanup invoked by the dispatcher when a session closes
 * without an explicit per-schema disable (crash, client disconnect,
 * shell shutdown). Releases this session's port registration and
 * decrements the shared refcount once, even if multiple schemas were
 * enabled. Idempotent — a subsequent `updateAgentContext(false, …)`
 * will see an empty `enabledSchemas` and no-op.
 */
async function closeAgentContext(
    context: SessionContext<__AgentName__Context>,
): Promise<void> {
    const ctx = context.agentContext;
    await withSessionLock(ctx, async () => {
        const hadRegistration = ctx.portRegistration !== undefined;
        ctx.enabledSchemas.clear();
        ctx.portRegistration?.release();
        delete ctx.portRegistration;
        if (!hadRegistration) return;
        sharedRefCount = Math.max(0, sharedRefCount - 1);
        if (sharedRefCount === 0 && sharedBridge) {
            const bridge = sharedBridge;
            sharedBridge = undefined;
            sharedClosingPromise = bridge.close().finally(() => {
                sharedClosingPromise = undefined;
            });
            await sharedClosingPromise;
        }
    });
}

async function updateAgentContext(
    enable: boolean,
    context: SessionContext<__AgentName__Context>,
    schemaName: string,
): Promise<void> {
    const ctx = context.agentContext;
    await withSessionLock(ctx, async () => {
        if (enable) {
            if (ctx.enabledSchemas.has(schemaName)) return;
            const bridge = await ensureSharedBridge();
            // Register + bump refcount only on the first schema for this
            // session. `ctx.portRegistration` (not set size) is the source
            // of truth for "this session has incremented sharedRefCount",
            // so a later disable / closeAgentContext won't double-decrement
            // even if a prior enable failed mid-way.
            if (ctx.portRegistration === undefined) {
                // Per-session registration: the registrar allows multiple
                // entries for ("__agentName__", "default") across sessions and
                // lookup returns the most recent, so each active session
                // independently keeps the shared port discoverable.
                ctx.portRegistration = context.registerPort(
                    "default",
                    bridge.port,
                );
                sharedRefCount++;
            }
            ctx.enabledSchemas.add(schemaName);
        } else {
            if (!ctx.enabledSchemas.has(schemaName)) return;
            ctx.enabledSchemas.delete(schemaName);
            if (
                ctx.enabledSchemas.size === 0 &&
                ctx.portRegistration !== undefined
            ) {
                // Release this session's registration before potentially
                // closing the server. Release is idempotent and a no-op if
                // already released by the dispatcher's closeSessionContext
                // backstop.
                ctx.portRegistration.release();
                delete ctx.portRegistration;
                sharedRefCount = Math.max(0, sharedRefCount - 1);
                if (sharedRefCount === 0 && sharedBridge) {
                    const bridge = sharedBridge;
                    sharedBridge = undefined;
                    sharedClosingPromise = bridge.close().finally(() => {
                        sharedClosingPromise = undefined;
                    });
                    await sharedClosingPromise;
                }
            }
        }
    });
}

async function executeAction(
    action: TypeAgentAction<__AgentName__Actions>,
    _context: ActionContext<__AgentName__Context>,
): Promise<ActionResult> {
    if (!sharedBridge?.connected) {
        return {
            error: "Host plugin not connected to the __agentName__ bridge. Start the plugin and ensure it is configured for the port reported by @system ports.",
        };
    }
    try {
        const result = await sharedBridge.send(
            action.actionName,
            action.parameters,
        );
        return createActionResultFromTextDisplay(
            JSON.stringify(result, null, 2),
        );
    } catch (err: any) {
        return { error: err?.message ?? String(err) };
    }
}
