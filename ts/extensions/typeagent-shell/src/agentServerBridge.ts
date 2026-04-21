// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { connectAgentServer } from "@typeagent/agent-server-client";
import type {
    AgentServerConnection,
    SessionDispatcher,
} from "@typeagent/agent-server-client";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-rpc/types";
import type { IAgentMessage, RequestId } from "@typeagent/dispatcher-types";
import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";
import type { TemplateEditConfig } from "@typeagent/dispatcher-types";
import type { PendingInteractionRequest } from "@typeagent/dispatcher-types";

/**
 * Messages from extension host → webview
 */
export type BridgeToWebviewMessage =
    | { type: "status"; connected: boolean; sessionId?: string }
    | { type: "setDisplay"; message: IAgentMessage; seq?: number }
    | {
          type: "appendDisplay";
          message: IAgentMessage;
          mode: DisplayAppendMode;
          seq?: number;
      }
    | {
          type: "setDisplayInfo";
          requestId: RequestId;
          source: string;
          actionIndex?: number;
          action?: TypeAgentAction | string[];
          seq?: number;
      }
    | {
          type: "setUserRequest";
          requestId: RequestId;
          command: string;
          seq?: number;
      }
    | { type: "clear"; requestId: RequestId }
    | { type: "notify"; event: string; data: any; source: string; seq?: number }
    | { type: "commandResult"; requestId: string; result: any }
    | { type: "error"; message: string };

/**
 * Messages from webview → extension host
 */
export type BridgeFromWebviewMessage =
    | { type: "sendCommand"; command: string; requestId?: string }
    | { type: "connect" }
    | { type: "disconnect" }
    | { type: "getStatus" };

/**
 * Manages the RPC connection to the agent server from the extension host
 * and bridges messages to/from webview panels.
 */
export class AgentServerBridge {
    private connection: AgentServerConnection | undefined;
    private session: SessionDispatcher | undefined;
    private webviews: Set<vscode.Webview> = new Set();
    private statusBarItem: vscode.StatusBarItem;
    private isConnected = false;
    private reconnectTimer: NodeJS.Timeout | undefined;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100,
        );
        this.statusBarItem.command = "typeagent-shell.focusChat";
        this.updateStatusBar(false);
        this.statusBarItem.show();
    }

    /**
     * Register a webview to receive messages from the server.
     */
    registerWebview(webview: vscode.Webview): vscode.Disposable {
        this.webviews.add(webview);

        // Handle messages from the webview
        const disposable = webview.onDidReceiveMessage((msg) =>
            this.handleWebviewMessage(msg, webview),
        );

        // Send current status
        this.postToWebview(webview, {
            type: "status",
            connected: this.isConnected,
            sessionId: this.session?.sessionId,
        });

        return {
            dispose: () => {
                this.webviews.delete(webview);
                disposable.dispose();
            },
        };
    }

    /**
     * Connect to the agent server.
     */
    async connect(): Promise<void> {
        if (this.isConnected) {
            return;
        }

        const config = vscode.workspace.getConfiguration("typeagent");
        const serverUrl = config.get<string>(
            "serverUrl",
            "ws://localhost:3000",
        );

        try {
            this.connection = await connectAgentServer(serverUrl, () => {
                // onDisconnect callback
                this.isConnected = false;
                this.session = undefined;
                this.updateStatusBar(false);
                this.broadcastToWebviews({ type: "status", connected: false });
                this.scheduleReconnect();
            });

            // Join the default session with our ClientIO implementation
            const clientIO = this.createClientIO();
            this.session = await this.connection.joinSession(clientIO, {
                clientType: "extension",
            });

            this.isConnected = true;
            this.updateStatusBar(true);
            this.broadcastToWebviews({
                type: "status",
                connected: true,
                sessionId: this.session.sessionId,
            });
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            this.broadcastToWebviews({ type: "error", message: msg });
            this.updateStatusBar(false);
            this.scheduleReconnect();
        }
    }

    /**
     * Disconnect from the agent server.
     */
    async disconnect(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.connection) {
            await this.connection.close();
            this.connection = undefined;
            this.session = undefined;
            this.isConnected = false;
            this.updateStatusBar(false);
            this.broadcastToWebviews({ type: "status", connected: false });
        }
    }

    dispose(): void {
        this.disconnect();
        this.statusBarItem.dispose();
    }

    private async handleWebviewMessage(
        msg: BridgeFromWebviewMessage,
        _webview: vscode.Webview,
    ): Promise<void> {
        switch (msg.type) {
            case "sendCommand":
                await this.sendCommand(msg.command);
                break;
            case "connect":
                await this.connect();
                break;
            case "disconnect":
                await this.disconnect();
                break;
            case "getStatus":
                this.broadcastToWebviews({
                    type: "status",
                    connected: this.isConnected,
                    sessionId: this.session?.sessionId,
                });
                break;
        }
    }

    private async sendCommand(command: string): Promise<void> {
        if (!this.session) {
            this.broadcastToWebviews({
                type: "error",
                message: "Not connected to agent server",
            });
            return;
        }

        try {
            const result =
                await this.session.dispatcher.processCommand(command);
            // Result will be communicated through ClientIO callbacks
            if (result) {
                this.broadcastToWebviews({
                    type: "commandResult",
                    requestId: "",
                    result,
                });
            }
        } catch (e: any) {
            this.broadcastToWebviews({
                type: "error",
                message: e?.message ?? String(e),
            });
        }
    }

    /**
     * Create a ClientIO implementation that forwards calls to the webview.
     */
    private createClientIO(): ClientIO {
        return {
            question: async (
                _requestId: RequestId | undefined,
                message: string,
                choices: string[],
                _defaultId?: number,
                _source?: string,
            ): Promise<number> => {
                // Show VS Code quick pick for questions
                const items = choices.map((c, i) => ({
                    label: c,
                    index: i,
                }));
                const pick = await vscode.window.showQuickPick(items, {
                    placeHolder: message,
                });
                return pick?.index ?? 0;
            },
            proposeAction: async (
                _requestId: RequestId,
                _actionTemplates: TemplateEditConfig,
                _source: string,
            ): Promise<unknown> => {
                return undefined;
            },
            openLocalView: async () => {},
            closeLocalView: async () => {},

            // ClientIO call functions (fire-and-forget notifications)
            clear: (requestId: RequestId) => {
                this.broadcastToWebviews({ type: "clear", requestId });
            },
            exit: (_requestId: RequestId) => {
                // No-op in extension context
            },
            setUserRequest: (
                requestId: RequestId,
                command: string,
                seq?: number,
            ) => {
                this.broadcastToWebviews({
                    type: "setUserRequest",
                    requestId,
                    command,
                    seq,
                });
            },
            setDisplayInfo: (
                requestId: RequestId,
                source: string,
                actionIndex?: number,
                action?: TypeAgentAction | string[],
                seq?: number,
            ) => {
                this.broadcastToWebviews({
                    type: "setDisplayInfo",
                    requestId,
                    source,
                    actionIndex,
                    action,
                    seq,
                });
            },
            setDisplay: (message: IAgentMessage, seq?: number) => {
                this.broadcastToWebviews({
                    type: "setDisplay",
                    message,
                    seq,
                });
            },
            appendDisplay: (
                message: IAgentMessage,
                mode: DisplayAppendMode,
                seq?: number,
            ) => {
                this.broadcastToWebviews({
                    type: "appendDisplay",
                    message,
                    mode,
                    seq,
                });
            },
            appendDiagnosticData: () => {},
            setDynamicDisplay: () => {},
            notify: (
                _notificationId: string | RequestId | undefined,
                event: string,
                data: any,
                source: string,
                seq?: number,
            ) => {
                this.broadcastToWebviews({
                    type: "notify",
                    event,
                    data,
                    source,
                    seq,
                });
            },
            requestChoice: () => {},
            requestInteraction: (_interaction: PendingInteractionRequest) => {},
            interactionResolved: () => {},
            interactionCancelled: () => {},
            takeAction: () => {},
        };
    }

    private broadcastToWebviews(msg: BridgeToWebviewMessage): void {
        for (const webview of this.webviews) {
            this.postToWebview(webview, msg);
        }
    }

    private postToWebview(
        webview: vscode.Webview,
        msg: BridgeToWebviewMessage,
    ): void {
        webview.postMessage(msg);
    }

    private updateStatusBar(connected: boolean): void {
        if (connected) {
            this.statusBarItem.text = "$(plug) TypeAgent: Connected";
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = "$(debug-disconnect) TypeAgent: Disconnected";
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground",
            );
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect();
        }, 5000);
    }
}
