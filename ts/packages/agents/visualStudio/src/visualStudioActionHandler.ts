// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: websocket-bridge — bidirectional RPC to a host-side plugin.
// The agent owns a WebSocketServer; the host plugin connects as the client.
// Commands flow TypeAgent → WebSocket → plugin → response.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { WebSocketServer, WebSocket } from "ws";
import { VisualStudioActions } from "./visualStudioSchema.js";

// Port 5678 + 5679 are taken by the Excel agent (in the SecretAgents repo).
// Keep this in sync with AgentBridgeClient.cs in the VS extension host.
const BRIDGE_PORT = 5680;

// ---- WebSocket bridge --------------------------------------------------

type BridgeRequest = { id: string; actionName: string; parameters: unknown };
type BridgeResponse = {
    id: string;
    success: boolean;
    result?: unknown;
    error?: string;
};

class VisualStudioBridge {
    private wss: WebSocketServer | undefined;
    private client: WebSocket | undefined;
    private pending = new Map<string, (r: BridgeResponse) => void>();

    start(): void {
        const wss = new WebSocketServer({ port: BRIDGE_PORT });
        wss.on("error", (err) => {
            console.error(
                `[visualStudio] bridge WebSocketServer failed on port ${BRIDGE_PORT}:`,
                err,
            );
        });
        wss.on("listening", () => {
            console.log(
                `[visualStudio] bridge listening on ws://localhost:${BRIDGE_PORT}`,
            );
        });
        wss.on("connection", (ws) => {
            console.log("[visualStudio] host plugin connected");
            this.client = ws;
            ws.on("message", (data) => {
                const response = JSON.parse(data.toString()) as BridgeResponse;
                this.pending.get(response.id)?.(response);
                this.pending.delete(response.id);
            });
            ws.on("close", () => {
                console.log("[visualStudio] host plugin disconnected");
                this.client = undefined;
            });
            ws.on("error", (err) => {
                console.error("[visualStudio] host plugin socket error:", err);
            });
        });
        this.wss = wss;
    }

    async stop(): Promise<void> {
        return new Promise((resolve) => this.wss?.close(() => resolve()));
    }

    async send(actionName: string, parameters: unknown): Promise<unknown> {
        if (!this.client) {
            throw new Error("No host plugin connected on port " + BRIDGE_PORT);
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

// ---- Agent lifecycle ---------------------------------------------------

type Context = { bridge: VisualStudioBridge };

// Shared, process-singleton bridge: the VS extension only ever opens one
// WebSocket connection on port 5680, so per-session bridges would collide on
// `new WebSocketServer({ port: 5680 })` (EADDRINUSE) the moment a second
// session/conversation initializes the visualStudio agent. Created on first
// initialize, closed when the last session disables. Mirrors the pattern used
// by the code agent's CodeAgentWebSocketServer.
let sharedBridge: VisualStudioBridge | undefined;
let sharedBridgeRefCount = 0;

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        closeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<Context> {
    if (sharedBridge === undefined) {
        sharedBridge = new VisualStudioBridge();
        sharedBridge.start();
    }
    sharedBridgeRefCount++;
    return { bridge: sharedBridge };
}

async function updateAgentContext(
    _enable: boolean,
    _context: SessionContext<Context>,
    _schemaName: string,
): Promise<void> {}

async function closeAgentContext(
    _context: SessionContext<Context>,
): Promise<void> {
    if (sharedBridgeRefCount === 0) {
        return;
    }
    sharedBridgeRefCount--;
    if (sharedBridgeRefCount === 0 && sharedBridge !== undefined) {
        const toStop = sharedBridge;
        sharedBridge = undefined;
        await toStop.stop();
    }
}

async function executeAction(
    action: TypeAgentAction<VisualStudioActions>,
    context: ActionContext<Context>,
): Promise<ActionResult> {
    const { bridge } = context.sessionContext.agentContext;
    if (!bridge.connected) {
        return {
            error: `Host plugin not connected. Make sure the visualStudio plugin is running on port ${BRIDGE_PORT}.`,
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
