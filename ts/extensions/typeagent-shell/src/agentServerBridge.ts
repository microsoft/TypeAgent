// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as os from "os";
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
import type { SessionInfo } from "@typeagent/agent-server-protocol";

/**
 * Messages from extension host → webview
 */
export type BridgeToWebviewMessage =
    | { type: "status"; connected: boolean; sessionId?: string; sessionName?: string }
    | { type: "sessionChanged"; sessionId: string; sessionName: string }
    | { type: "setDisplay"; message: IAgentMessage; seq?: number; timestamp?: number }
    | {
          type: "appendDisplay";
          message: IAgentMessage;
          mode: DisplayAppendMode;
          seq?: number;
          timestamp?: number;
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
          timestamp?: number;
      }
    | { type: "clear"; requestId: RequestId }
    | { type: "notify"; event: string; data: any; source: string; seq?: number; requestId?: string }
    | { type: "commandResult"; requestId: string; result: any }
    | { type: "commandComplete"; requestId: string; result: any }
    | { type: "peerMetrics"; requestId: string; result: any }
    | { type: "pcState"; state?: CompletionState }
    | { type: "error"; message: string }
    | { type: "switching"; switching: boolean; targetName?: string }
    | { type: "userInfo"; name: string }
    | { type: "setActive"; active: boolean }
    | { type: "historyLoading"; loading: boolean }
    | {
          type: "historyReplay";
          entries: Array<{
              type: string;
              seq: number;
              timestamp?: number;
              // user-request
              command?: string;
              // set-display / append-display
              message?: IAgentMessage;
              mode?: DisplayAppendMode;
              // set-display-info
              source?: string;
              action?: TypeAgentAction | string[];
              actionIndex?: number;
              requestId?: RequestId;
              // command-result
              metrics?: any;
          }>;
      };

import {
    createCompletionController,
    type CompletionController,
    type CompletionState,
} from "agent-dispatcher/helpers/completion";
import type { CompletionDirection } from "@typeagent/agent-sdk";

/**
 * Messages from webview → extension host
 */
export type BridgeFromWebviewMessage =
    | { type: "sendCommand"; command: string; requestId?: string }
    | { type: "connect" }
    | { type: "disconnect" }
    | { type: "getStatus" }
    | { type: "focus"; focused: boolean }
    | { type: "pcUpdate"; input: string; direction: CompletionDirection }
    | { type: "pcAccept" }
    | { type: "pcDismiss"; input: string; direction: CompletionDirection }
    | { type: "pcHide" }
    | { type: "pcDispose" };

/**
 * Manages the RPC connection to the agent server from the extension host
 * and bridges messages to/from webview panels.
 */
export class AgentServerBridge {
    // Static registry: bridges grouped by sessionId, so the originator of a
    // command can broadcast its result/metrics to peer tabs sharing the same
    // session (the agent-server clientIO doesn't carry per-request metrics).
    private static bridgesBySession: Map<string, Set<AgentServerBridge>> =
        new Map();

    private static registerForSession(
        sessionId: string,
        bridge: AgentServerBridge,
    ): void {
        let set = AgentServerBridge.bridgesBySession.get(sessionId);
        if (!set) {
            set = new Set();
            AgentServerBridge.bridgesBySession.set(sessionId, set);
        }
        set.add(bridge);
    }

    private static unregisterForSession(
        sessionId: string,
        bridge: AgentServerBridge,
    ): void {
        const set = AgentServerBridge.bridgesBySession.get(sessionId);
        if (!set) return;
        set.delete(bridge);
        if (set.size === 0) {
            AgentServerBridge.bridgesBySession.delete(sessionId);
        }
    }

    private connection: AgentServerConnection | undefined;
    private session: SessionDispatcher | undefined;
    private webviews: Set<vscode.Webview> = new Set();
    private statusBarItem: vscode.StatusBarItem;
    private isConnected = false;
    private reconnectTimer: NodeJS.Timeout | undefined;
    // Suppress disconnect handler during intentional reconnects
    private isSwitching = false;
    // Track which session we've already replayed history for, so we
    // don't replay again on simple websocket reconnects (which would
    // create muted duplicates of live messages).
    private lastReplayedSessionId: string | undefined;

    // Configuration
    private readonly ownsStatusBar: boolean;
    private readonly ephemeralSessionName: string | undefined;
    private displayName: string;
    // Track ephemeral session we created so we can delete on dispose
    private ephemeralSessionId: string | undefined;
    private nameOverride: string | undefined;
    // Notify when this bridge's status/session changes — used by extension
    // to update the shared status bar when this bridge is active.
    private onStatusChanged?: () => void;
    private onWebviewFocusChanged?: (focused: boolean) => void;
    /** If set, connect() will join this existing session instead of creating one. */
    private restoreSessionId: string | undefined;

    // Per-session command-completion controller (lazy).  Each webview that
    // requests completions is tracked here; replies are sent only to the
    // requesting webview to keep peer tabs from competing.
    private completionController: CompletionController | undefined;
    private completionWebview: vscode.Webview | undefined;

    constructor(opts?: {
        ownsStatusBar?: boolean;
        ephemeralSessionName?: string;
        displayName?: string;
        restoreSessionId?: string;
    }) {
        this.ownsStatusBar = opts?.ownsStatusBar ?? true;
        this.ephemeralSessionName = opts?.ephemeralSessionName;
        this.displayName = opts?.displayName ?? "TypeAgent";
        this.restoreSessionId = opts?.restoreSessionId;
        if (this.ownsStatusBar) {
            this.statusBarItem = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Left,
                100,
            );
            this.statusBarItem.command = "typeagent-shell.focusChat";
            this.updateStatusBar(false);
            this.statusBarItem.show();
        } else {
            this.statusBarItem = {
                dispose: () => {},
            } as unknown as vscode.StatusBarItem;
        }
    }

    /** Display name used in webview status bar / for routing UX. */
    getDisplayName(): string {
        if (this.nameOverride) return this.nameOverride;
        const sn = this.session?.name;
        // Auto-generated ephemeral names are ugly — show the friendly label
        if (sn && sn.startsWith("cli-ephemeral-vscode-")) {
            return this.displayName;
        }
        return sn ?? this.displayName;
    }

    isConnectedNow(): boolean {
        return this.isConnected;
    }

    /** Subscribe to connection / session-name changes. */
    onStatusChange(cb: () => void): vscode.Disposable {
        this.onStatusChanged = cb;
        return { dispose: () => { this.onStatusChanged = undefined; } };
    }

    onWebviewFocus(cb: (focused: boolean) => void): vscode.Disposable {
        this.onWebviewFocusChanged = cb;
        return { dispose: () => { this.onWebviewFocusChanged = undefined; } };
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

        // Send local user info so bubbles can show a real name/initial
        try {
            const name = os.userInfo().username;
            if (name) {
                this.postToWebview(webview, { type: "userInfo", name });
            }
        } catch {
            // os.userInfo() can throw on some configurations; ignore
        }

        // Send current status
        this.postToWebview(webview, {
            type: "status",
            connected: this.isConnected,
            sessionId: this.session?.sessionId,
        });

        return {
            dispose: () => {
                this.webviews.delete(webview);
                if (this.completionWebview === webview) {
                    this.disposeCompletionController();
                }
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
            "ws://localhost:8999",
        );

        try {
            this.connection = await connectAgentServer(serverUrl, () => {
                // onDisconnect callback — ignore during intentional reconnects
                if (this.isSwitching) {
                    return;
                }
                this.isConnected = false;
                if (this.session) {
                    AgentServerBridge.unregisterForSession(
                        this.session.sessionId,
                        this,
                    );
                }
                this.session = undefined;
                this.updateStatusBar(false);
                this.broadcastToWebviews({ type: "status", connected: false });
                this.onStatusChanged?.();
                this.scheduleReconnect();
            });

            // Join the session with our ClientIO implementation
            const clientIO = this.createClientIO();

            let joinOpts: any = {
                clientType: "extension",
                // filter: false so multiple tabs sharing the same session all
                // receive setDisplay/appendDisplay broadcasts. Per-connection
                // routing (askYesNo, clear, exit) goes through callback() and
                // is unaffected by this flag.
                filter: false,
            };
            if (this.restoreSessionId) {
                // Try to rejoin a session restored from a saved panel.
                // If it no longer exists on the server, fall through to the
                // ephemeral / default behavior so we still have a chat.
                try {
                    const sessions = await this.connection.listSessions();
                    if (sessions.some((s) => s.sessionId === this.restoreSessionId)) {
                        joinOpts.sessionId = this.restoreSessionId;
                    } else {
                        this.restoreSessionId = undefined;
                    }
                } catch {
                    // listSessions failed — try to join anyway
                    joinOpts.sessionId = this.restoreSessionId;
                }
            }
            if (
                joinOpts.sessionId === undefined &&
                this.ephemeralSessionName &&
                this.ephemeralSessionId === undefined
            ) {
                try {
                    const info = await this.connection.createSession(
                        this.ephemeralSessionName,
                    );
                    this.ephemeralSessionId = info.sessionId;
                    joinOpts.sessionId = info.sessionId;
                } catch {
                    // Fall back to default join if creation fails
                }
            } else if (
                joinOpts.sessionId === undefined &&
                this.ephemeralSessionId
            ) {
                joinOpts.sessionId = this.ephemeralSessionId;
            }

            this.session = await this.connection.joinSession(
                clientIO,
                joinOpts,
            );

            AgentServerBridge.registerForSession(
                this.session.sessionId,
                this,
            );

            this.isConnected = true;
            this.updateStatusBar(true);
            this.broadcastToWebviews({
                type: "status",
                connected: true,
                sessionId: this.session.sessionId,
                sessionName: this.getDisplayName(),
            });
            this.onStatusChanged?.();

            // Replay history only the first time we join this session.
            // On simple reconnects we already have the bubbles in the DOM
            // and re-replaying would create muted duplicates and (worse)
            // race against any live messages still in flight.
            if (this.lastReplayedSessionId !== this.session.sessionId) {
                this.lastReplayedSessionId = this.session.sessionId;
                await this.replayHistory(this.session);
            }
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
        // Tear down the per-session completion controller so a future
        // connect() rebuilds it against the new dispatcher.
        this.disposeCompletionController();
        if (this.connection) {
            await this.connection.close();
            this.connection = undefined;
            if (this.session) {
                AgentServerBridge.unregisterForSession(
                    this.session.sessionId,
                    this,
                );
            }
            this.session = undefined;
            this.isConnected = false;
            this.updateStatusBar(false);
            this.broadcastToWebviews({ type: "status", connected: false });
            this.onStatusChanged?.();
        }
    }

    dispose(): void {
        // Best-effort delete the ephemeral session we created for this panel
        const toDelete = this.ephemeralSessionId;
        const conn = this.connection;
        if (toDelete && conn) {
            // Fire-and-forget — don't block dispose
            conn
                .deleteSession(toDelete)
                .catch(() => {})
                .finally(() => {
                    this.disconnect();
                });
        } else {
            this.disconnect();
        }
        this.statusBarItem.dispose();
    }

    /**
     * Tell webviews bound to this bridge whether they are the active chat.
     * Used to visually mute non-active chats.
     */
    setActive(active: boolean): void {
        this.broadcastToWebviews({ type: "setActive", active });
    }

    /**
     * Clear the visible chat UI for this bridge's webviews.
     * Server-side history is left untouched; reload to replay.
     */
    clearChatUI(): void {
        this.broadcastToWebviews({
            type: "clear",
            requestId: "user-clear" as RequestId,
        });
    }

    // ── Conversation management ─────────────────────────────────

    /**
     * Show a QuickPick to switch conversations.
     */
    async switchSession(): Promise<void> {
        if (!this.connection) {
            vscode.window.showWarningMessage("Not connected to agent server.");
            return;
        }

        const sessions = await this.connection.listSessions();
        const currentId = this.session?.sessionId;

        const items = sessions.map((s) => ({
            label: s.name || s.sessionId.substring(0, 8),
            description: s.sessionId === currentId ? "(current)" : "",
            detail: `ID: ${s.sessionId} · Clients: ${s.clientCount}`,
            sessionId: s.sessionId,
        }));

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: "Select a conversation to switch to",
        });

        if (!pick || pick.sessionId === currentId) {
            return;
        }

        await this.joinSpecificSession(pick.sessionId, pick.label);
    }

    /**
     * Create a new conversation and switch to it.
     */
    async newSession(): Promise<void> {
        if (!this.connection) {
            vscode.window.showWarningMessage("Not connected to agent server.");
            return;
        }

        const sessions = await this.connection.listSessions();
        const existingNames = new Set(
            sessions.map((s) => s.name.toLowerCase()),
        );

        const name = await vscode.window.showInputBox({
            prompt: "Name for the new conversation",
            placeHolder: "My Conversation",
            validateInput: (value) => {
                if (!value.trim()) {
                    return "Conversation name cannot be empty";
                }
                if (existingNames.has(value.trim().toLowerCase())) {
                    return `A conversation named "${value.trim()}" already exists`;
                }
                return undefined;
            },
        });

        if (!name) {
            return;
        }

        const trimmed = name.trim();
        const info = await this.connection.createSession(trimmed);
        await this.joinSpecificSession(info.sessionId, trimmed);
        vscode.window.showInformationMessage(
            `Created and switched to conversation "${trimmed}"`,
        );
    }

    /**
     * Rename the current conversation.
     */
    async renameCurrentSession(): Promise<void> {
        if (!this.connection || !this.session) {
            vscode.window.showWarningMessage("No active conversation.");
            return;
        }

        const sessions = await this.connection.listSessions();
        const existingNames = new Set(
            sessions
                .filter((s) => s.sessionId !== this.session!.sessionId)
                .map((s) => s.name.toLowerCase()),
        );

        const newName = await vscode.window.showInputBox({
            prompt: "New name for the current conversation",
            placeHolder: "My Conversation",
            validateInput: (value) => {
                if (!value.trim()) {
                    return "Conversation name cannot be empty";
                }
                if (existingNames.has(value.trim().toLowerCase())) {
                    return `A conversation named "${value.trim()}" already exists`;
                }
                return undefined;
            },
        });

        if (!newName) {
            return;
        }

        await this.connection.renameSession(
            this.session.sessionId,
            newName.trim(),
        );
        this.nameOverride = newName.trim();
        this.broadcastToWebviews({
            type: "status",
            connected: true,
            sessionId: this.session.sessionId,
            sessionName: this.getDisplayName(),
        });
        this.onStatusChanged?.();
        vscode.window.showInformationMessage(
            `Renamed conversation to "${newName.trim()}"`,
        );
    }

    /**
     * Delete a conversation (shows picker, prevents deleting current).
     */
    async deleteSession(): Promise<void> {
        if (!this.connection) {
            vscode.window.showWarningMessage("Not connected to agent server.");
            return;
        }

        const sessions = await this.connection.listSessions();
        const currentId = this.session?.sessionId;

        const items = sessions
            .filter((s) => s.sessionId !== currentId)
            .map((s) => ({
                label: s.name || s.sessionId.substring(0, 8),
                detail: `ID: ${s.sessionId}`,
                sessionId: s.sessionId,
            }));

        if (items.length === 0) {
            vscode.window.showInformationMessage(
                "No other conversations to delete.",
            );
            return;
        }

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: "Select a conversation to delete",
        });

        if (!pick) {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete conversation "${pick.label}"?`,
            { modal: true },
            "Delete",
        );

        if (confirm === "Delete") {
            await this.connection.deleteSession(pick.sessionId);
            vscode.window.showInformationMessage(
                `Deleted conversation "${pick.label}"`,
            );
        }
    }

    /**
     * Leave the current conversation and join a different one.
     */
    /**
     * Switch to a different conversation using the join-before-leave pattern.
     * - Phase 1: join the new session. If this fails, the old session is
     *   still active so we report failure cleanly.
     * - Phase 2: leave the old session (best-effort).
     * - Phase 3: replay the new session's display history.
     */
    private async joinSpecificSession(
        sessionId: string,
        targetName?: string,
    ): Promise<void> {
        if (!this.connection) {
            return;
        }

        if (this.session?.sessionId === sessionId) {
            return;
        }

        this.isSwitching = true;
        this.broadcastToWebviews({
            type: "switching",
            switching: true,
            targetName,
        });
        try {
            // Phase 1: join new session first
            const clientIO = this.createClientIO();
            let newSession: SessionDispatcher;
            try {
                newSession = await this.connection.joinSession(clientIO, {
                    clientType: "extension",
                    filter: false,
                    sessionId,
                });
            } catch (e: any) {
                vscode.window.showErrorMessage(
                    `Failed to switch conversation: ${e?.message ?? String(e)}`,
                );
                return;
            }

            const oldSession = this.session;
            this.session = newSession;
            this.nameOverride = undefined;

            if (oldSession) {
                AgentServerBridge.unregisterForSession(
                    oldSession.sessionId,
                    this,
                );
            }
            AgentServerBridge.registerForSession(newSession.sessionId, this);

            // Phase 2: leave the old session (best-effort).
            // If we were on an ephemeral session and we're moving away from
            // it, also delete it so it doesn't pile up on the server.
            if (oldSession) {
                try {
                    await this.connection.leaveSession(oldSession.sessionId);
                } catch {
                    // Best effort
                }
                if (
                    this.ephemeralSessionId &&
                    oldSession.sessionId === this.ephemeralSessionId &&
                    newSession.sessionId !== this.ephemeralSessionId
                ) {
                    const epId = this.ephemeralSessionId;
                    this.ephemeralSessionId = undefined;
                    try {
                        await this.connection.deleteSession(epId);
                    } catch {
                        // Best effort
                    }
                }
            }

            // Phase 3: clear UI and replay history
            this.broadcastToWebviews({
                type: "sessionChanged",
                sessionId: newSession.sessionId,
                sessionName: this.getDisplayName(),
            });
            this.broadcastToWebviews({
                type: "status",
                connected: true,
                sessionId: newSession.sessionId,
                sessionName: this.getDisplayName(),
            });
            this.onStatusChanged?.();
            await this.replayHistory(newSession);
            this.lastReplayedSessionId = newSession.sessionId;
        } finally {
            this.isSwitching = false;
            this.broadcastToWebviews({
                type: "switching",
                switching: false,
            });
        }
    }

    /**
     * Replay the display history for the given session through the same
     * channels live messages use, wrapped in historyStart/historyEnd
     * markers so the webview can style replayed entries differently.
     */
    private async replayHistory(session: SessionDispatcher): Promise<void> {
        this.broadcastToWebviews({ type: "historyLoading", loading: true });
        try {
            await this.replayHistoryInner(session);
        } finally {
            this.broadcastToWebviews({
                type: "historyLoading",
                loading: false,
            });
        }
    }

    private async replayHistoryInner(
        session: SessionDispatcher,
    ): Promise<void> {
        let entries: Array<any>;
        try {
            entries = await session.dispatcher.getDisplayHistory();
        } catch {
            return;
        }

        if (entries.length === 0) {
            return;
        }

        // Send the whole history as a single message — avoids slow per-entry
        // postMessage round trips and prevents live events from being
        // interleaved mid-replay.
        this.broadcastToWebviews({
            type: "historyReplay",
            entries: entries.map((e) => {
                switch (e.type) {
                    case "user-request":
                        return {
                            type: "user-request",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            requestId: e.requestId,
                            command: e.command,
                        };
                    case "set-display":
                        return {
                            type: "set-display",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            message: e.message,
                        };
                    case "append-display":
                        return {
                            type: "append-display",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            message: e.message,
                            mode: e.mode,
                        };
                    case "set-display-info":
                        return {
                            type: "set-display-info",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            requestId: e.requestId,
                            source: e.source,
                            actionIndex: e.actionIndex,
                            action: e.action,
                        };
                    case "command-result":
                        return {
                            type: "command-result",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            requestId: e.requestId,
                            metrics: e.metrics,
                        };
                    default:
                        return { type: "skip", seq: e.seq };
                }
            }),
        });
    }

    private async handleWebviewMessage(
        msg: BridgeFromWebviewMessage,
        _webview: vscode.Webview,
    ): Promise<void> {
        switch (msg.type) {
            case "sendCommand":
                await this.sendCommand(msg.command, msg.requestId);
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
            case "focus":
                this.onWebviewFocusChanged?.(msg.focused);
                break;
            case "pcUpdate":
                this.pcUpdate(_webview, msg.input, msg.direction);
                break;
            case "pcAccept":
                this.completionController?.accept();
                break;
            case "pcDismiss":
                this.completionController?.dismiss(msg.input, msg.direction);
                break;
            case "pcHide":
                this.completionController?.hide();
                break;
            case "pcDispose":
                this.disposeCompletionController();
                break;
        }
    }

    private ensureCompletionController(
        webview: vscode.Webview,
    ): CompletionController | undefined {
        if (!this.session) return undefined;
        if (
            this.completionController &&
            this.completionWebview === webview
        ) {
            return this.completionController;
        }
        // If an existing controller is bound to a different webview, tear it
        // down — the per-keystroke onUpdate must target the typing webview.
        this.disposeCompletionController();
        this.completionWebview = webview;
        const session = this.session;
        this.completionController = createCompletionController(
            {
                getCommandCompletion: async (input, direction) => {
                    return await session.dispatcher.getCommandCompletion(
                        input,
                        direction,
                    );
                },
            },
            {
                onUpdate: () => {
                    const state =
                        this.completionController?.getCompletionState();
                    webview.postMessage({ type: "pcState", state });
                },
            },
        );
        return this.completionController;
    }

    private pcUpdate(
        webview: vscode.Webview,
        input: string,
        direction: CompletionDirection,
    ): void {
        const controller = this.ensureCompletionController(webview);
        controller?.update(input, direction);
    }

    private disposeCompletionController(): void {
        this.completionController?.dispose();
        this.completionController = undefined;
        this.completionWebview = undefined;
    }

    /**
     * If the current session is the bridge's ephemeral session and the user
     * has just produced activity, give it a real (persistent) name so it is
     * not deleted on panel close or by the server's startup sweep.
     */
    private async promoteEphemeralIfNeeded(): Promise<void> {
        if (!this.connection || !this.session) return;
        if (!this.ephemeralSessionId) return;
        if (this.session.sessionId !== this.ephemeralSessionId) return;

        const stamp = new Date()
            .toISOString()
            .replace("T", " ")
            .slice(0, 16);
        const base = `${this.displayName} ${stamp}`;
        let name = base;
        try {
            const sessions = await this.connection.listSessions();
            const taken = new Set(sessions.map((s) => s.name));
            let n = 2;
            while (taken.has(name)) {
                name = `${base} (${n++})`;
            }
            await this.connection.renameSession(
                this.session.sessionId,
                name,
            );
            this.nameOverride = name;
            this.ephemeralSessionId = undefined;
            this.broadcastToWebviews({
                type: "status",
                connected: true,
                sessionId: this.session.sessionId,
                sessionName: this.getDisplayName(),
            });
            this.onStatusChanged?.();
        } catch {
            // Best effort — if rename fails (e.g. server rejects), the
            // session stays ephemeral and will still be cleaned up.
        }
    }

    private async sendCommand(
        command: string,
        requestId?: string,
    ): Promise<void> {
        if (!this.session) {
            this.broadcastToWebviews({
                type: "error",
                message: "Not connected to agent server",
            });
            return;
        }

        // Once the user actually engages with an ephemeral panel session,
        // promote it to a persistent named session so it survives panel
        // close and the server's startup sweep of cli-ephemeral-* sessions.
        await this.promoteEphemeralIfNeeded();

        try {
            const result = await this.session.dispatcher.processCommand(
                command,
                requestId,
            );
            // Command finished — tell webview to clean up temporary status
            this.broadcastToWebviews({
                type: "commandComplete",
                requestId: requestId ?? "",
                result: result ?? null,
            });
            // Forward metrics to peer tabs sharing this session so their
            // bubbles for this requestId also pick up the timing tooltip.
            this.broadcastMetricsToPeers(requestId, result ?? null);
        } catch (e: any) {
            this.broadcastToWebviews({
                type: "commandComplete",
                requestId: requestId ?? "",
                result: null,
            });
            this.broadcastToWebviews({
                type: "error",
                message: e?.message ?? String(e),
            });
        }
    }

    private broadcastMetricsToPeers(
        requestId: string | undefined,
        result: any,
    ): void {
        if (!requestId || !this.session) return;
        const peers = AgentServerBridge.bridgesBySession.get(
            this.session.sessionId,
        );
        if (!peers) return;
        for (const peer of peers) {
            if (peer === this) continue;
            peer.broadcastToWebviews({
                type: "peerMetrics",
                requestId,
                result,
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
                notificationId: string | RequestId | undefined,
                event: string,
                data: any,
                source: string,
                seq?: number,
            ) => {
                // RequestId is an object {requestId, clientRequestId};
                // we tag bubbles by the clientRequestId we generated.
                let clientRequestId: string | undefined;
                if (typeof notificationId === "string") {
                    clientRequestId = notificationId;
                } else if (notificationId && typeof notificationId === "object") {
                    clientRequestId = (notificationId as any)
                        .clientRequestId as string | undefined;
                }
                this.broadcastToWebviews({
                    type: "notify",
                    event,
                    data,
                    source,
                    seq,
                    requestId: clientRequestId,
                });
            },
            requestChoice: () => {},
            requestInteraction: (_interaction: PendingInteractionRequest) => {},
            interactionResolved: () => {},
            interactionCancelled: () => {},
            takeAction: (_requestId, action, data) => {
                if (action === "vscode-shell-action") {
                    this.handleShellAction(data).catch((e: any) => {
                        vscode.window.showErrorMessage(
                            `Shell action failed: ${e?.message ?? String(e)}`,
                        );
                    });
                }
            },
        };
    }

    /**
     * Handle a "vscode-shell-action" routed from the code agent. Targeted
     * to the originating client by the agent server's takeAction routing,
     * so only this bridge (the originator's bridge) receives it.
     */
    private async handleShellAction(data: any): Promise<void> {
        if (!data || typeof data !== "object") return;
        const actionName = data.actionName as string | undefined;
        const params = (data.parameters ?? {}) as {
            name?: string;
            newName?: string;
        };

        switch (actionName) {
            case "newConversation":
                await this.newConversationFromAgent(params.name);
                break;
            case "renameConversation":
                if (params.newName) {
                    await this.renameCurrentConversationFromAgent(
                        params.newName,
                    );
                }
                break;
            case "switchConversation":
                await this.switchConversationFromAgent(params.name);
                break;
        }
    }

    /**
     * Create a new conversation programmatically (from a chat-issued
     * action). If `name` is omitted, falls back to the interactive prompt.
     */
    private async newConversationFromAgent(name?: string): Promise<void> {
        if (!this.connection) {
            vscode.window.showWarningMessage("Not connected to agent server.");
            return;
        }
        if (!name || !name.trim()) {
            await this.newSession();
            return;
        }

        const trimmed = name.trim();
        const sessions = await this.connection.listSessions();
        const existing = sessions.find(
            (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (existing) {
            vscode.window.showWarningMessage(
                `A conversation named "${trimmed}" already exists; switching to it.`,
            );
            await this.joinSpecificSession(existing.sessionId, existing.name);
            return;
        }

        const info = await this.connection.createSession(trimmed);
        await this.joinSpecificSession(info.sessionId, trimmed);
        vscode.window.showInformationMessage(
            `Created and switched to conversation "${trimmed}"`,
        );
    }

    /**
     * Rename the current conversation programmatically (from chat).
     */
    private async renameCurrentConversationFromAgent(
        newName: string,
    ): Promise<void> {
        if (!this.connection || !this.session) {
            vscode.window.showWarningMessage("No active conversation.");
            return;
        }
        const trimmed = newName.trim();
        if (!trimmed) return;

        const sessions = await this.connection.listSessions();
        const collision = sessions.find(
            (s) =>
                s.sessionId !== this.session!.sessionId &&
                s.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (collision) {
            vscode.window.showErrorMessage(
                `A conversation named "${trimmed}" already exists.`,
            );
            return;
        }

        await this.connection.renameSession(this.session.sessionId, trimmed);
        this.nameOverride = trimmed;
        this.broadcastToWebviews({
            type: "status",
            connected: true,
            sessionId: this.session.sessionId,
            sessionName: this.getDisplayName(),
        });
        this.onStatusChanged?.();
        vscode.window.showInformationMessage(
            `Renamed conversation to "${trimmed}"`,
        );
    }

    /**
     * Switch to a conversation by display name (from chat). Falls back to
     * the interactive picker if no name was provided or no match found.
     */
    private async switchConversationFromAgent(name?: string): Promise<void> {
        if (!this.connection) {
            vscode.window.showWarningMessage("Not connected to agent server.");
            return;
        }
        if (!name || !name.trim()) {
            await this.switchSession();
            return;
        }

        const trimmed = name.trim();
        const sessions = await this.connection.listSessions();
        const match = sessions.find(
            (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (!match) {
            vscode.window.showWarningMessage(
                `No conversation named "${trimmed}" found.`,
            );
            return;
        }
        if (match.sessionId === this.session?.sessionId) {
            return;
        }
        await this.joinSpecificSession(match.sessionId, match.name);
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
        if (!this.ownsStatusBar) return;
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
