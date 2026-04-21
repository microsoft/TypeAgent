// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Agent server WebSocket connection for the VS Code webview.
// Uses the same RPC protocol as the shell renderer's webSocketAPI.ts:
//   - dispatcher-rpc-call / dispatcher-rpc-reply for agent commands
//   - clientio-rpc-call / clientio-rpc-reply for UI callbacks

import { ChatUI } from "./chatUI";

interface RpcMessage {
    name: string;
    id: number;
    args?: unknown[];
    result?: unknown;
    error?: string;
}

interface ServerMessage {
    message: string;
    data: RpcMessage;
}

/**
 * Manages the WebSocket connection to the TypeAgent agent server
 * and translates RPC messages to/from the chat UI.
 */
export class AgentConnection {
    private _ws: WebSocket | undefined;
    private _url = "";
    private _rpcId = 0;
    private _pendingCalls = new Map<
        number,
        { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private _keepAliveTimer: ReturnType<typeof setInterval> | undefined;
    private _partialText = "";

    constructor(private readonly _chatUI: ChatUI) {}

    public connect(url: string): void {
        this._url = url;
        this._chatUI.setStatus("connecting", `Connecting to ${url}…`);
        this._doConnect();
    }

    /**
     * Send a user request to the agent server via the dispatcher RPC.
     */
    public sendRequest(text: string): void {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            this._chatUI.addSystemMessage(
                "Not connected to agent server",
            );
            return;
        }

        this._chatUI.addUserMessage(text);
        this._sendDispatcherCall("processCommand", [text]);
    }

    // ── WebSocket lifecycle ─────────────────────────────────────────

    private _doConnect(): void {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = undefined;
        }

        try {
            this._ws = new WebSocket(this._url);
        } catch (err) {
            this._chatUI.setStatus(
                "disconnected",
                `Failed to connect: ${err}`,
            );
            this._scheduleReconnect();
            return;
        }

        this._ws.onopen = () => {
            this._chatUI.setStatus("connected");
            this._startKeepAlive();
        };

        this._ws.onmessage = (event) => {
            this._handleMessage(event.data as string);
        };

        this._ws.onclose = () => {
            this._chatUI.setStatus("disconnected");
            this._stopKeepAlive();
            this._rejectAllPending("Connection closed");
            this._scheduleReconnect();
        };

        this._ws.onerror = () => {
            // onclose will also fire, so just log
            console.warn("[AgentConnection] WebSocket error");
        };
    }

    private _scheduleReconnect(): void {
        if (this._reconnectTimer) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = undefined;
            this._chatUI.setStatus(
                "connecting",
                "Reconnecting…",
            );
            this._doConnect();
        }, 3000);
    }

    private _startKeepAlive(): void {
        this._stopKeepAlive();
        this._keepAliveTimer = setInterval(() => {
            if (this._ws?.readyState === WebSocket.OPEN) {
                this._ws.send(
                    JSON.stringify({
                        source: "vscode-extension",
                        target: "none",
                        messageType: "keepAlive",
                        body: {},
                    }),
                );
            }
        }, 20_000);
    }

    private _stopKeepAlive(): void {
        if (this._keepAliveTimer) {
            clearInterval(this._keepAliveTimer);
            this._keepAliveTimer = undefined;
        }
    }

    // ── RPC protocol ────────────────────────────────────────────────

    private _sendDispatcherCall(
        method: string,
        args: unknown[],
    ): void {
        const id = ++this._rpcId;
        const rpcMsg: RpcMessage = { name: method, id, args };
        this._ws?.send(
            JSON.stringify({
                message: "dispatcher-rpc-call",
                data: rpcMsg,
            }),
        );

        // Track for response
        new Promise((resolve, reject) => {
            this._pendingCalls.set(id, { resolve, reject });
        }).catch(() => {
            // Handled when rejected
        });
    }

    private _sendClientIOReply(id: number, result: unknown): void {
        this._ws?.send(
            JSON.stringify({
                message: "clientio-rpc-reply",
                data: { id, result },
            }),
        );
    }

    private _handleMessage(raw: string): void {
        let msg: ServerMessage;
        try {
            msg = JSON.parse(raw);
        } catch {
            console.warn("[AgentConnection] Invalid JSON:", raw);
            return;
        }

        switch (msg.message) {
            case "dispatcher-rpc-reply":
                this._handleDispatcherReply(msg.data);
                break;
            case "clientio-rpc-call":
                this._handleClientIOCall(msg.data);
                break;
            case "setting-summary-changed":
                // Ignore for now
                break;
            default:
                console.log(
                    "[AgentConnection] Unhandled message:",
                    msg.message,
                );
        }
    }

    private _handleDispatcherReply(data: RpcMessage): void {
        const pending = this._pendingCalls.get(data.id);
        if (pending) {
            this._pendingCalls.delete(data.id);
            if (data.error) {
                pending.reject(new Error(data.error));
            } else {
                pending.resolve(data.result);
            }
        }
    }

    /**
     * Handle ClientIO RPC calls from the server — these are the
     * display callbacks (setDisplay, appendDisplay, etc.).
     */
    private _handleClientIOCall(data: RpcMessage): void {
        const args = data.args ?? [];
        switch (data.name) {
            case "setDisplay":
                this._partialText = String(args[0] ?? "");
                this._chatUI.updatePartialMessage(this._partialText);
                this._sendClientIOReply(data.id, undefined);
                break;

            case "appendDisplay":
                this._partialText += String(args[0] ?? "");
                this._chatUI.updatePartialMessage(this._partialText);
                this._sendClientIOReply(data.id, undefined);
                break;

            case "setDynamicDisplay":
                // Dynamic display is ephemeral status text
                this._chatUI.updatePartialMessage(
                    String(args[1] ?? args[0] ?? ""),
                );
                this._sendClientIOReply(data.id, undefined);
                break;

            case "clear":
                this._partialText = "";
                this._chatUI.finalizePartialMessage();
                this._sendClientIOReply(data.id, undefined);
                break;

            case "setUserRequest":
                // Acknowledge — the user message is already shown
                this._sendClientIOReply(data.id, undefined);
                break;

            case "question":
                // Default to first choice for now
                this._sendClientIOReply(data.id, args[3] ?? 0);
                break;

            case "proposeAction":
                // Auto-accept proposed actions
                this._sendClientIOReply(data.id, undefined);
                break;

            case "notify": {
                const event = args[0] as string;
                if (
                    event === "showNotifications" ||
                    event === "randomCommandSelected"
                ) {
                    // Finalize any partial message
                    if (this._partialText) {
                        this._chatUI.finalizePartialMessage();
                        this._partialText = "";
                    }
                }
                this._sendClientIOReply(data.id, undefined);
                break;
            }

            default:
                // Acknowledge unknown calls to prevent server-side timeouts
                this._sendClientIOReply(data.id, undefined);
                break;
        }
    }

    private _rejectAllPending(reason: string): void {
        for (const [id, pending] of this._pendingCalls) {
            pending.reject(new Error(reason));
            this._pendingCalls.delete(id);
        }
    }
}
