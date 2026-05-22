// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: websocket-bridge — bidirectional RPC to a host-side plugin.
// The agent owns a WebSocketServer; the host plugin connects as the client.
// Commands flow TypeAgent → WebSocket → plugin → response.
//
// Port handling: the bridge binds an ephemeral port (OS-assigned via
// `bind(0)`) and publishes the actual port to the PortRegistrar under
// role `"default"`. The Visual Studio extension discovers the port via
// the dispatcher's discovery channel (`AGENT_SERVER_PORT` →
// `lookupPort("visualStudio", "default")`). For local debugging the env
// var `VISUALSTUDIO_BRIDGE_PORT` pins a fixed port (useful when running
// the extension in a debugger that can't easily read the discovery
// channel).

import {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { AddressInfo } from "net";
import registerDebug from "debug";
import { VisualStudioActions } from "./visualStudioSchema.js";
import { isAllowedAgentOrigin } from "./originAllowlist.js";

const debug = registerDebug("typeagent:visualstudio:bridge");

// ---- WebSocket bridge --------------------------------------------------

type BridgeRequest = { id: string; actionName: string; parameters: unknown };
type BridgeResponse = {
    id: string;
    success: boolean;
    result?: unknown;
    error?: string;
};

class VisualStudioBridge {
    // Multi-client tracking. The bridge accepts every VS extension that
    // dials in (insertion-order-preserving Map so we can route to the
    // most-recently-connected one). Keys are synthetic ids — the VS
    // extension's `ClientWebSocket` doesn't expose anything we could
    // use to distinguish two parallel instances.
    private clients: Map<string, WebSocket> = new Map();
    private clientIdCounter = 0;
    // For each in-flight request we record which clientId we sent it
    // to, so a disconnect on one VS only fails the requests that
    // actually targeted that instance — other VS instances keep
    // running. The id itself is bridge-wide (responses are looked up
    // by id alone).
    private pending = new Map<
        string,
        {
            resolve: (r: BridgeResponse) => void;
            timer: NodeJS.Timeout;
            clientId: string;
        }
    >();
    private readonly sendTimeoutMs: number;

    /**
     * Invoked on every client connect/disconnect with the current count
     * of OPEN clients. Set by the agent-lifecycle code; the bridge
     * itself doesn't care about consumers. Errors raised by the
     * callback are swallowed (the count is informational and only
     * surfaces via `@system ports`).
     */
    public onClientCountChanged?: (count: number) => void;

    /**
     * @param wss   the underlying ws server, already bound and listening.
     * @param port  the actually bound port (OS-assigned when caller
     *              passed 0, or the env-pinned value when set).
     *
     * Construction is private — use {@link VisualStudioBridge.start} so
     * callers always get a bridge that is guaranteed to be bound before
     * they read {@link port} or pass it to the registrar.
     */
    private constructor(
        private readonly wss: WebSocketServer,
        public readonly port: number,
    ) {
        this.sendTimeoutMs = resolveSendTimeoutMs();
        this.setupHandlers();
        debug(
            `VisualStudioBridge listening on port ${port} (sendTimeoutMs=${this.sendTimeoutMs})`,
        );
    }

    /**
     * Bind a new bridge on `port`. Resolves only after the `listening`
     * event so callers can synchronously read {@link port}; rejects on
     * the first `error` event so bind failures (EADDRINUSE under a
     * fixed-port override) surface loudly instead of being swallowed by
     * an attached error handler.
     *
     * Pass `0` to let the OS pick a free ephemeral port; the actual port
     * is then available via {@link port}.
     */
    public static start(port: number = 0): Promise<VisualStudioBridge> {
        return new Promise((resolve, reject) => {
            const wss = new WebSocketServer({
                port,
                // Bind loopback-only so the bridge isn't reachable from
                // other hosts on the LAN. The Origin allowlist below
                // accepts requests with no Origin header (the C#
                // ClientWebSocket doesn't send one), so without an
                // explicit loopback bind a remote attacker on the same
                // network could otherwise drive EnvDTE actions.
                host: "127.0.0.1",
                // Gate every upgrade on Origin so a random web page on
                // the same host can't dial the ephemeral port assigned
                // by the OS. `verifyClient` runs synchronously before
                // the `connection` event fires; rejected requests get
                // HTTP 403. The C# `ClientWebSocket` doesn't send
                // Origin, which `isAllowedAgentOrigin` accepts.
                verifyClient: (info, cb) => {
                    const origin = info.req.headers.origin as
                        | string
                        | undefined;
                    if (isAllowedAgentOrigin(origin)) {
                        cb(true);
                    } else {
                        debug(`Rejecting WS upgrade from origin ${origin}`);
                        cb(false, 403, "Origin not allowed");
                    }
                },
            });
            let settled = false;
            const onError = (error: Error) => {
                if (settled) {
                    debug("Server error after listening:", error);
                    return;
                }
                settled = true;
                wss.removeListener("listening", onListening);
                debug("Server bind error:", error);
                reject(error);
            };
            const onListening = () => {
                if (settled) return;
                settled = true;
                wss.removeListener("error", onError);
                const address = wss.address() as AddressInfo | null;
                if (!address || typeof address === "string") {
                    wss.close();
                    reject(
                        new Error(
                            "ws server.address() did not return an AddressInfo",
                        ),
                    );
                    return;
                }
                // Re-attach a permanent error handler so post-listen
                // errors are logged rather than crashing the process.
                wss.on("error", (err) => {
                    debug("Server error:", err);
                });
                resolve(new VisualStudioBridge(wss, address.port));
            };
            wss.once("error", onError);
            wss.once("listening", onListening);
        });
    }

    private setupHandlers(): void {
        this.wss.on("connection", (ws: WebSocket) => {
            const clientId = `vs-${++this.clientIdCounter}`;
            this.clients.set(clientId, ws);
            debug(
                `host plugin connected (${clientId}); total=${this.clients.size}`,
            );
            this.emitClientCount();
            ws.on("message", (data: RawData) => {
                try {
                    const response = JSON.parse(
                        data.toString(),
                    ) as BridgeResponse;
                    const entry = this.pending.get(response.id);
                    if (entry !== undefined) {
                        clearTimeout(entry.timer);
                        this.pending.delete(response.id);
                        entry.resolve(response);
                    }
                } catch (err) {
                    debug("Failed to parse plugin message:", err);
                }
            });
            const onDisconnect = (reason: string) => {
                // Identity-guarded so the second of {close, error} is a
                // no-op (Map.delete returns false the second time).
                if (!this.clients.delete(clientId)) return;
                debug(
                    `host plugin disconnected (${clientId}, ${reason}); remaining=${this.clients.size}`,
                );
                this.emitClientCount();
                // Only fail the pending sends that targeted *this*
                // client — other VS instances stay live and their
                // pending requests must keep waiting for their own
                // responses (or hit the per-request timeout).
                this.failPendingForClient(
                    clientId,
                    new Error(`Host plugin disconnected: ${reason}`),
                );
            };
            ws.on("close", () => onDisconnect("close"));
            ws.on("error", (err) => {
                debug("host plugin socket error:", err);
                onDisconnect(`error: ${err.message}`);
            });
        });
    }

    private emitClientCount(): void {
        try {
            this.onClientCountChanged?.(this.getConnectedCount());
        } catch (err) {
            debug("onClientCountChanged threw:", err);
        }
    }

    /**
     * Number of currently-OPEN bridge clients. Surfaced via
     * `@system ports` through the SessionContext's
     * `notifyClientCountChanged` API. Multiple VS instances can
     * connect concurrently and each is counted independently.
     */
    public getConnectedCount(): number {
        let n = 0;
        for (const ws of this.clients.values()) {
            if (ws.readyState === WebSocket.OPEN) n++;
        }
        return n;
    }

    private failPending(error: Error): void {
        if (this.pending.size === 0) return;
        const entries = Array.from(this.pending.values());
        this.pending.clear();
        for (const entry of entries) {
            clearTimeout(entry.timer);
            entry.resolve({
                id: "",
                success: false,
                error: error.message,
            });
        }
    }

    private failPendingForClient(clientId: string, error: Error): void {
        const toFail: string[] = [];
        for (const [id, entry] of this.pending) {
            if (entry.clientId === clientId) toFail.push(id);
        }
        for (const id of toFail) {
            const entry = this.pending.get(id)!;
            this.pending.delete(id);
            clearTimeout(entry.timer);
            entry.resolve({
                id: "",
                success: false,
                error: error.message,
            });
        }
    }

    /**
     * Close the underlying server and resolve once the port is fully
     * released — important for a rapid disable→enable cycle under a
     * fixed-port override (`VISUALSTUDIO_BRIDGE_PORT`), where a
     * synchronous return would race the new bind into EADDRINUSE.
     */
    async stop(): Promise<void> {
        debug("Closing VisualStudioBridge");
        for (const ws of this.clients.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        }
        this.clients.clear();
        // Reject any in-flight sends before the server closes; otherwise
        // callers awaiting `send()` hang forever after a manual disable.
        this.failPending(new Error("VisualStudioBridge stopped"));
        return new Promise((resolve) => this.wss.close(() => resolve()));
    }

    async send(actionName: string, parameters: unknown): Promise<unknown> {
        // Route to the most-recently-connected OPEN client. This
        // preserves the legacy single-client behavior (where the
        // newest connection won) when only one VS is active, and
        // gives a sensible "last-wins" tiebreak for multi-VS sessions
        // — RPCs like buildSolution can't sensibly broadcast (both
        // VS instances would execute), and a smarter routing strategy
        // (per-solution-path, user-disambiguated) is future work.
        const target = this.pickTargetClient();
        if (target === undefined) {
            throw new Error(`No host plugin connected on port ${this.port}`);
        }
        const [clientId, ws] = target;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return new Promise((resolve, reject) => {
            // Timeout so a plugin that accepts the WS frame but never
            // replies (deadlock, EnvDTE hang, killed mid-action) doesn't
            // wedge the caller. The pending entry is cleared either by
            // the response handler or this timer — whichever fires
            // first.
            const timer = setTimeout(() => {
                if (this.pending.delete(id)) {
                    reject(
                        new Error(
                            `VS bridge action '${actionName}' timed out after ${this.sendTimeoutMs}ms`,
                        ),
                    );
                }
            }, this.sendTimeoutMs);
            this.pending.set(id, {
                timer,
                clientId,
                resolve: (res) =>
                    res.success
                        ? resolve(res.result)
                        : reject(new Error(res.error)),
            });
            try {
                ws.send(
                    JSON.stringify({
                        id,
                        actionName,
                        parameters,
                    } satisfies BridgeRequest),
                );
            } catch (err) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(err);
            }
        });
    }

    // Map iteration is insertion-ordered; walk in reverse so the
    // newest OPEN connection wins. Returns undefined when no client
    // is currently OPEN.
    private pickTargetClient(): [string, WebSocket] | undefined {
        const entries = Array.from(this.clients.entries());
        for (let i = entries.length - 1; i >= 0; i--) {
            const [id, ws] = entries[i];
            if (ws.readyState === WebSocket.OPEN) return [id, ws];
        }
        return undefined;
    }

    get connected(): boolean {
        return this.getConnectedCount() > 0;
    }
}

// ---- Port resolution ---------------------------------------------------

const DEFAULT_SEND_TIMEOUT_MS = 30_000;

// Per-action send() timeout. EnvDTE actions are typically subsecond,
// but a few (build/run, attach-to-process) can run for tens of seconds
// on a cold solution. Default 30s leaves headroom; override via env for
// debugging long-running actions.
function resolveSendTimeoutMs(): number {
    const raw = process.env["VISUALSTUDIO_BRIDGE_SEND_TIMEOUT_MS"];
    if (raw === undefined || raw === "") return DEFAULT_SEND_TIMEOUT_MS;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        console.warn(
            `Ignoring malformed VISUALSTUDIO_BRIDGE_SEND_TIMEOUT_MS=${raw}; using ${DEFAULT_SEND_TIMEOUT_MS}ms`,
        );
        return DEFAULT_SEND_TIMEOUT_MS;
    }
    return n;
}

// Optional fixed-port override. Useful when launching the Visual Studio
// extension in a debugger and you want both sides on a known port —
// pair this with `TYPEAGENT_VS_BRIDGE_PORT=<same port>` on the C# host
// to bypass discovery on both ends.
//
// Malformed values are warned and ignored — we fall through to the
// OS-assigned port. If the requested port is already in use,
// `VisualStudioBridge.start()` rejects with that error instead of
// silently rebinding.
function getBridgeBindPort(): number {
    const raw = process.env["VISUALSTUDIO_BRIDGE_PORT"];
    if (raw === undefined || raw === "") return 0;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
        console.warn(
            `Ignoring malformed VISUALSTUDIO_BRIDGE_PORT=${raw}; using OS-assigned port instead`,
        );
        return 0;
    }
    debug(`VISUALSTUDIO_BRIDGE_PORT override active: ${n}`);
    return n;
}

// ---- Agent lifecycle ---------------------------------------------------

type Context = {
    bridge?: VisualStudioBridge;
    portRegistration?: { release: () => void };
};

// Shared, process-singleton bridge: the VS extension only ever opens one
// WebSocket connection on the bound port, so per-session bridges would
// collide on `new WebSocketServer({ port })` (EADDRINUSE under fixed-port
// override) the moment a second session/conversation initializes the
// visualStudio agent. Created on first initialize, closed when the last
// session disables. Mirrors the pattern used by the code agent's
// `CodeAgentWebSocketServer`.
let sharedBridge: VisualStudioBridge | undefined;
let sharedStartingPromise: Promise<VisualStudioBridge> | undefined;
let sharedClosingPromise: Promise<void> | undefined;
let sharedBridgeRefCount = 0;
// Active sessions currently holding a `(visualStudio, default)`
// registration on the shared bridge. Insertion order picks a "primary"
// session for client-count reporting: the primary publishes the global
// count, the rest publish 0, so `@system ports` doesn't double-count
// when summing per-session entries. See codeActionHandler for the
// reference implementation.
const sharedActiveSessions = new Set<SessionContext<Context>>();

function publishClientCountFanout(count: number): void {
    const primary = sharedActiveSessions.values().next().value;
    for (const sc of sharedActiveSessions) {
        void sc.notifyClientCountChanged("default", sc === primary ? count : 0);
    }
}

async function ensureSharedBridge(): Promise<VisualStudioBridge> {
    // If a previous teardown is still releasing the port, await it
    // before binding again (matters under VISUALSTUDIO_BRIDGE_PORT
    // override).
    if (sharedClosingPromise !== undefined) {
        await sharedClosingPromise;
    }
    if (sharedBridge !== undefined) return sharedBridge;
    if (sharedStartingPromise !== undefined) return sharedStartingPromise;
    sharedStartingPromise = (async () => {
        try {
            const bridge = await VisualStudioBridge.start(getBridgeBindPort());
            // Fan out client-count updates to active sessions. The
            // bridge fires this on every connect/disconnect; the
            // primary-session pattern in `publishClientCountFanout`
            // prevents the `@system ports` summing logic from
            // double-counting across sessions that each registered
            // the SAME physical port.
            bridge.onClientCountChanged = publishClientCountFanout;
            sharedBridge = bridge;
            return bridge;
        } finally {
            sharedStartingPromise = undefined;
        }
    })();
    return sharedStartingPromise;
}

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        closeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<Context> {
    return {};
}

async function updateAgentContext(
    enable: boolean,
    context: SessionContext<Context>,
    _schemaName: string,
): Promise<void> {
    const agentContext = context.agentContext;
    if (enable) {
        if (agentContext.bridge !== undefined) return;
        try {
            const bridge = await ensureSharedBridge();
            agentContext.bridge = bridge;
            // Per-session registration: the registrar allows multiple
            // entries for `(visualStudio, default)` across sessions and
            // lookup returns the most recent, so each active session
            // independently keeps the shared port discoverable. The
            // backstop in closeSessionContext releases ours if disable
            // is skipped.
            agentContext.portRegistration = context.registerPort(
                "default",
                bridge.port,
            );
            sharedBridgeRefCount++;
            sharedActiveSessions.add(context);
            // Publish the current (global) count to the primary
            // session (first in insertion order) and 0 to this session
            // if it isn't the primary, so `@system ports` summing
            // doesn't double-count. If this session is now becoming
            // the primary (i.e. it's the first to enable), it gets the
            // real count; otherwise it reports 0 and any future
            // onClientCountChanged fanout keeps it at 0.
            const primary = sharedActiveSessions.values().next().value;
            void context.notifyClientCountChanged(
                "default",
                context === primary ? bridge.getConnectedCount() : 0,
            );
        } catch (e) {
            // Roll back per-session bookkeeping so a subsequent retry
            // sees a clean slate. The shared bridge is left untouched —
            // its refcount only advances on the success path below
            // `registerPort`, and other sessions may still be using it.
            delete agentContext.bridge;
            delete agentContext.portRegistration;
            throw e;
        }
    } else {
        if (agentContext.bridge === undefined) return;
        delete agentContext.bridge;
        // Release this session's registration before potentially closing
        // the bridge. Release is idempotent and a no-op if already
        // released by the backstop.
        agentContext.portRegistration?.release();
        delete agentContext.portRegistration;

        const wasPrimary =
            sharedActiveSessions.values().next().value === context;
        sharedActiveSessions.delete(context);

        sharedBridgeRefCount = Math.max(0, sharedBridgeRefCount - 1);
        if (sharedBridgeRefCount === 0 && sharedBridge !== undefined) {
            const toStop = sharedBridge;
            sharedBridge = undefined;
            // Track the in-flight close so a rapid re-enable awaits
            // port release under a fixed-port override.
            sharedClosingPromise = toStop.stop().finally(() => {
                sharedClosingPromise = undefined;
            });
            await sharedClosingPromise;
        } else if (wasPrimary && sharedBridge !== undefined) {
            // Primary session went away — transfer the (global) count
            // to the new primary so `@system ports` keeps reporting
            // the real number instead of 0.
            const newPrimary = sharedActiveSessions.values().next().value;
            if (newPrimary !== undefined) {
                void newPrimary.notifyClientCountChanged(
                    "default",
                    sharedBridge.getConnectedCount(),
                );
            }
        }
    }
}

async function closeAgentContext(
    context: SessionContext<Context>,
): Promise<void> {
    // Defensive cleanup if updateAgentContext(false) wasn't invoked.
    await updateAgentContext(false, context, "");
}

async function executeAction(
    action: TypeAgentAction<VisualStudioActions>,
    context: ActionContext<Context>,
): Promise<ActionResult> {
    const { bridge } = context.sessionContext.agentContext;
    if (!bridge) {
        return {
            error: "visualStudio agent is not enabled in this session.",
        };
    }
    if (!bridge.connected) {
        return {
            error: `Host plugin not connected on port ${bridge.port}. Make sure the visualStudio extension is running.`,
        };
    }
    try {
        const result = await bridge.send(action.actionName, action.parameters);
        return createActionResultFromTextDisplay(
            JSON.stringify(result, null, 2),
        );
    } catch (err: any) {
        return { error: err?.message ?? String(err) };
    }
}
