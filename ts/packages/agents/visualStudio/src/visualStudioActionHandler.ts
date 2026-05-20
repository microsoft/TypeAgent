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
    private client: WebSocket | undefined;
    private pending = new Map<string, (r: BridgeResponse) => void>();

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
        this.setupHandlers();
        debug(`VisualStudioBridge listening on port ${port}`);
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
            debug("host plugin connected");
            this.client = ws;
            ws.on("message", (data: RawData) => {
                try {
                    const response = JSON.parse(
                        data.toString(),
                    ) as BridgeResponse;
                    this.pending.get(response.id)?.(response);
                    this.pending.delete(response.id);
                } catch (err) {
                    debug("Failed to parse plugin message:", err);
                }
            });
            ws.on("close", () => {
                debug("host plugin disconnected");
                this.client = undefined;
            });
            ws.on("error", (err) => {
                debug("host plugin socket error:", err);
            });
        });
    }

    /**
     * Close the underlying server and resolve once the port is fully
     * released — important for a rapid disable→enable cycle under a
     * fixed-port override (`VISUALSTUDIO_BRIDGE_PORT`), where a
     * synchronous return would race the new bind into EADDRINUSE.
     */
    async stop(): Promise<void> {
        debug("Closing VisualStudioBridge");
        if (this.client?.readyState === WebSocket.OPEN) {
            this.client.close();
        }
        this.client = undefined;
        return new Promise((resolve) => this.wss.close(() => resolve()));
    }

    async send(actionName: string, parameters: unknown): Promise<unknown> {
        if (!this.client) {
            throw new Error(`No host plugin connected on port ${this.port}`);
        }
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return new Promise((resolve, reject) => {
            this.pending.set(id, (res) =>
                res.success
                    ? resolve(res.result)
                    : reject(new Error(res.error)),
            );
            this.client!.send(
                JSON.stringify({
                    id,
                    actionName,
                    parameters,
                } satisfies BridgeRequest),
            );
        });
    }

    get connected(): boolean {
        return this.client !== undefined;
    }
}

// ---- Port resolution ---------------------------------------------------

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
