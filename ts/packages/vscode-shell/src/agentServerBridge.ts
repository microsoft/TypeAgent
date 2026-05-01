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
 * Coerce a RequestId (server-side `{requestId, clientRequestId}` shape) or
 * already-string identifier down to the plain client request id used
 * throughout the webview. Returns undefined if no usable id is present.
 *
 * The webview never deals in `RequestId` objects — every outgoing bridge
 * message normalizes through this helper so `main.ts` can use plain string
 * comparisons / map keys.
 */
function clientIdOf(rid: RequestId | string | undefined): string | undefined {
    if (rid === undefined || rid === null) return undefined;
    if (typeof rid === "string") return rid;
    return (rid as { clientRequestId?: string }).clientRequestId;
}

/**
 * Messages from extension host → webview
 */
export type BridgeToWebviewMessage =
    | { type: "status"; connected: boolean; sessionId?: string; sessionName?: string }
    | { type: "sessionChanged"; sessionId: string; sessionName: string }
    | {
          type: "setDisplay";
          message: IAgentMessage;
          requestId?: string;
          seq?: number;
          timestamp?: number;
      }
    | {
          type: "appendDisplay";
          message: IAgentMessage;
          requestId?: string;
          mode: DisplayAppendMode;
          seq?: number;
          timestamp?: number;
      }
    | {
          type: "setDisplayInfo";
          requestId?: string;
          source: string;
          actionIndex?: number;
          action?: TypeAgentAction | string[];
          seq?: number;
      }
    | {
          type: "setUserRequest";
          requestId?: string;
          command: string;
          seq?: number;
          timestamp?: number;
      }
    | { type: "clear"; requestId?: string }
    | { type: "notify"; event: string; data: any; source: string; seq?: number; requestId?: string }
    | { type: "commandResult"; requestId: string; result: any }
    | { type: "commandComplete"; requestId: string; result: any }
    | { type: "peerMetrics"; requestId: string; result: any }
    | { type: "pcState"; state?: CompletionState }
    | { type: "error"; message: string; requestId?: string }
    | {
          // Single in-place reconnect status shown in the connection
          // ribbon. `phase: "waiting"` means a backoff timer is running
          // and `secondsRemaining` is the live countdown. `connecting`
          // means an attempt is in progress. `cleared` means we're back
          // online and any reconnect UI should disappear.
          type: "reconnectStatus";
          phase: "waiting" | "connecting" | "cleared";
          attempt?: number;
          secondsRemaining?: number;
          error?: string;
      }
    | { type: "switching"; switching: boolean; targetName?: string }
    | { type: "userInfo"; name: string }
    | { type: "setActive"; active: boolean }
    | {
          type: "demoState";
          running: boolean;
          paused: boolean;
          message?: string;
      }
    | { type: "demoTypeAndSend"; command: string; requestId: string }
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
              requestId?: string;
              // command-result
              metrics?: any;
              tokenUsage?: any;
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
    | { type: "cancelCommand"; requestId: string }
    | { type: "openExternal"; href: string }
    | { type: "connect" }
    | { type: "disconnect" }
    | { type: "getStatus" }
    | { type: "focus"; focused: boolean }
    | { type: "pcUpdate"; input: string; direction: CompletionDirection }
    | { type: "pcAccept" }
    | { type: "pcDismiss"; input: string; direction: CompletionDirection }
    | { type: "pcHide" }
    | { type: "pcDispose" }
    | { type: "demoCommand"; action: "continue" | "cancel" };

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
    /** In-flight connect promise — prevents parallel connect() races. */
    private connectInFlight: Promise<void> | undefined;
    /** In-flight session-join promise — serializes joinSpecificSession calls. */
    private joinInFlight: Promise<void> | undefined;
    private session: SessionDispatcher | undefined;
    private webviews: Set<vscode.Webview> = new Set();
    private statusBarItem: vscode.StatusBarItem;
    private isConnected = false;
    private reconnectTimer: NodeJS.Timeout | undefined;
    // Single in-place countdown shown in the connection ribbon while we
    // wait between reconnect attempts. Replaces the old behavior of
    // broadcasting a fresh error/disconnect message every retry cycle.
    private reconnectCountdown: NodeJS.Timeout | undefined;
    private reconnectAttempt = 0;
    private reconnectRemainingSec: number | undefined;
    private lastConnectError: string | undefined;
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
    /**
     * Bumped every time a completion controller is created or disposed so
     * stale onUpdate callbacks (from a controller that's been torn down by
     * a webview switch) can detect they're obsolete and not post state to
     * the wrong webview. The dispatcher's getCommandCompletion is async,
     * so the callback may fire after `this.completionController` has been
     * replaced — without the generation check we would post NEW state to
     * the OLD webview's closure-captured target.
     */
    private completionGeneration = 0;

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
            this.statusBarItem.command = "vscode-shell.focusChat";
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

    /** Current session id, if joined. */
    getSessionId(): string | undefined {
        return this.session?.sessionId;
    }

    /** True when the current session is the bridge's own ephemeral session. */
    isOnEphemeralSession(): boolean {
        return (
            this.ephemeralSessionId !== undefined &&
            this.session?.sessionId === this.ephemeralSessionId
        );
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
        // Coalesce parallel connect() calls — wireWebview is invoked once
        // per surface (sidebar + each restored panel) and they can land
        // before the first connect resolves. Without this guard, each
        // call opens its own WebSocket, but the awaits in this method
        // cross-pollute via `this.connection` (a later overwrite is
        // visible to an earlier task after its next await), so two
        // tasks end up calling joinSession on the same connection's
        // channel adapter → "Channel 'clientio:<id>' already exists".
        if (this.connectInFlight) {
            return this.connectInFlight;
        }
        this.connectInFlight = this.connectImpl().finally(() => {
            this.connectInFlight = undefined;
        });
        return this.connectInFlight;
    }

    private async connectImpl(): Promise<void> {

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
            // Capture locally so subsequent awaits aren't affected by
            // any future reassignment of this.connection.
            const connection = this.connection;

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
                    const sessions = await connection.listSessions();
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
                    const info = await connection.createSession(
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

            this.session = await connection.joinSession(
                clientIO,
                joinOpts,
            );

            AgentServerBridge.registerForSession(
                this.session.sessionId,
                this,
            );

            this.isConnected = true;
            this.updateStatusBar(true);
            this.clearReconnectState();
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
            // Suppress per-attempt error toasts in the chat area; the
            // connection ribbon now shows a single in-place countdown
            // via reconnectStatus broadcasts. Stash the message so the
            // ribbon can surface "Disconnected (last error: ...)".
            this.lastConnectError = msg;
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
        if (this.reconnectCountdown) {
            clearInterval(this.reconnectCountdown);
            this.reconnectCountdown = undefined;
        }
        this.reconnectRemainingSec = undefined;
        this.broadcastReconnect("cleared");
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
            requestId: "user-clear",
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
        // Serialize concurrent calls. Two joinSpecificSession invocations
        // overlapping (e.g., user rapid-clicks the session picker) would
        // otherwise both pass the no-op guard below — `this.session` hasn't
        // been updated by the first call yet — and both would call
        // connection.joinSession, triggering the agent-server's "Channel
        // already exists" rejection on the second.
        if (this.joinInFlight) {
            try {
                await this.joinInFlight;
            } catch {
                // The previous join failed; we still proceed with our own.
            }
        }
        if (this.session?.sessionId === sessionId) {
            return;
        }
        if (!this.connection) {
            return;
        }
        const p = this.joinSpecificSessionImpl(sessionId, targetName);
        this.joinInFlight = p.finally(() => {
            if (this.joinInFlight === p) {
                this.joinInFlight = undefined;
            }
        });
        return this.joinInFlight;
    }

    private async joinSpecificSessionImpl(
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
        // Start buffering live ClientIO events that arrive during the
        // (potentially slow) getDisplayHistory call so they don't render
        // before the replayed history block. Once the historyReplay message
        // is queued for the webviews, we flush the buffer so live events
        // appear after the replayed prefix as expected.
        this.replayBuffer = [];
        let entries: Array<any>;
        try {
            entries = await session.dispatcher.getDisplayHistory();
        } catch {
            this.flushReplayBuffer();
            return;
        }

        if (entries.length === 0) {
            this.flushReplayBuffer();
            return;
        }

        // Send the whole history as a single message — avoids slow per-entry
        // postMessage round trips and prevents live events from being
        // interleaved mid-replay.
        const replayMsg: BridgeToWebviewMessage = {
            type: "historyReplay",
            entries: entries.map((e) => {
                switch (e.type) {
                    case "user-request":
                        return {
                            type: "user-request",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            requestId: clientIdOf(e.requestId),
                            command: e.command,
                        };
                    case "set-display":
                        return {
                            type: "set-display",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            message: e.message,
                            requestId: clientIdOf(e.message?.requestId),
                        };
                    case "append-display":
                        return {
                            type: "append-display",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            message: e.message,
                            mode: e.mode,
                            requestId: clientIdOf(e.message?.requestId),
                        };
                    case "set-display-info":
                        return {
                            type: "set-display-info",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            requestId: clientIdOf(e.requestId),
                            source: e.source,
                            actionIndex: e.actionIndex,
                            action: e.action,
                        };
                    case "command-result":
                        return {
                            type: "command-result",
                            seq: e.seq,
                            timestamp: e.timestamp,
                            requestId: clientIdOf(e.requestId),
                            metrics: e.metrics,
                            tokenUsage: (e as any).tokenUsage,
                        };
                    default:
                        return { type: "skip", seq: e.seq };
                }
            }),
        };
        // historyReplay is not in REPLAY_BUFFERED_TYPES so this passes
        // through immediately.
        this.broadcastToWebviews(replayMsg);
        this.flushReplayBuffer();
    }

    private flushReplayBuffer(): void {
        const buf = this.replayBuffer;
        this.replayBuffer = undefined;
        if (!buf || buf.length === 0) return;
        for (const msg of buf) {
            this.broadcastToWebviews(msg);
        }
    }

    private async handleWebviewMessage(
        msg: BridgeFromWebviewMessage,
        _webview: vscode.Webview,
    ): Promise<void> {
        switch (msg.type) {
            case "sendCommand":
                await this.sendCommand(msg.command, msg.requestId);
                break;
            case "cancelCommand":
                // Forward to the dispatcher so an in-flight request can be
                // cancelled mid-flight (e.g., user clicks the stop button on
                // a long-running action). The dispatcher answers with a
                // CommandResult marked wasCancelled=true on its normal path.
                //
                // The webview only knows the clientRequestId it generated;
                // the dispatcher tracks AbortControllers by its OWN
                // server-side requestId. Translate via the map populated
                // from setUserRequest. Fall back to the raw id only as a
                // last resort (e.g., cancel arrived before setUserRequest).
                try {
                    const mapped =
                        this.clientToServerRequestId.get(msg.requestId);
                    const serverId = mapped ?? msg.requestId;
                    this.session?.dispatcher.cancelCommand(serverId);
                } catch (e) {
                    console.warn(
                        "[agentServerBridge] cancelCommand failed:",
                        e,
                    );
                }
                break;
            case "openExternal":
                // Webviews can't open arbitrary external URLs; route through
                // the extension host so VS Code applies its trust prompt.
                if (msg.href) {
                    void vscode.env.openExternal(vscode.Uri.parse(msg.href));
                }
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
            case "demoCommand":
                vscode.commands.executeCommand(
                    msg.action === "continue"
                        ? "vscode-shell.demoContinue"
                        : "vscode-shell.demoCancel",
                );
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
        const myGeneration = ++this.completionGeneration;
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
                    // Stale-callback guard: if the controller has been
                    // disposed/replaced (webview switch) since this callback
                    // was registered, do not post state — otherwise the
                    // closure-captured `webview` would receive completion
                    // results meant for a different panel.
                    if (myGeneration !== this.completionGeneration) return;
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
        // Bump generation so any pending onUpdate callbacks from the dying
        // controller treat themselves as stale.
        this.completionGeneration++;
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

    /**
     * Send a command to the active session and wait for it to complete.
     * Used by the in-extension demo runner so the user sees each line
     * arrive as a normal user message and the agent responds in real
     * time. Errors are surfaced via the webview, never thrown.
     *
     * The line is forwarded to the active webview which animates it being
     * typed character-by-character into the chat input (parity with the
     * Electron shell's demo runner) and then submits it through the normal
     * onSend → sendCommand pipeline. We wait on a per-requestId resolver
     * that sendCommand fires once processCommand returns.
     */
    public async runCommand(command: string): Promise<void> {
        const requestId = `demo-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;

        const completion = new Promise<void>((resolve) => {
            this.demoCompletionResolvers.set(requestId, resolve);
        });

        this.broadcastToWebviews({
            type: "demoTypeAndSend",
            command,
            requestId,
        });

        try {
            await completion;
        } finally {
            this.demoCompletionResolvers.delete(requestId);
        }
    }

    private demoCompletionResolvers = new Map<string, () => void>();

    // Map webview-generated clientRequestId -> dispatcher's server-side
    // requestId. The dispatcher's cancelCommand() looks up its in-flight
    // AbortController by the SERVER id, so the webview's stop button
    // (which only knows the client id) needs this translation. We
    // populate it from setUserRequest, which fires on every accepted
    // command with both ids on the RequestId object.
    private clientToServerRequestId = new Map<string, string>();

    private async sendCommand(
        command: string,
        requestId?: string,
    ): Promise<void> {

        // Once the user actually engages with an ephemeral panel session,
        // promote it to a persistent named session so it survives panel
        // close and the server's startup sweep of cli-ephemeral-* sessions.
        await this.promoteEphemeralIfNeeded();

        // Bail out gracefully if the session was disposed (e.g. the user
        // switched conversations or the server dropped) between the
        // user pressing send and us getting here. Without this guard
        // the next line throws "Cannot read properties of undefined
        // (reading 'dispatcher')" and the webview's stop button stays
        // stuck on screen.
        if (!this.session) {
            this.broadcastToWebviews({
                type: "commandComplete",
                requestId: requestId ?? "",
                result: null,
            });
            this.broadcastToWebviews({
                type: "error",
                message: "No active session — reconnect or pick a conversation.",
                requestId: requestId ?? "",
            });
            return;
        }

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
        } finally {
            // Wake up any demo-runner await waiting on this requestId.
            if (requestId) {
                const resolve = this.demoCompletionResolvers.get(requestId);
                if (resolve) {
                    this.demoCompletionResolvers.delete(requestId);
                    resolve();
                }
                // Also drop the client→server requestId mapping; the
                // dispatcher has freed its AbortController by now.
                this.clientToServerRequestId.delete(requestId);
            }
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
                this.broadcastToWebviews({
                    type: "clear",
                    requestId: clientIdOf(requestId),
                });
            },
            exit: (_requestId: RequestId) => {
                // No-op in extension context
            },
            setUserRequest: (
                requestId: RequestId,
                command: string,
                seq?: number,
            ) => {
                // Record client→server requestId translation so the stop
                // button (which posts the client id) can be turned into
                // the dispatcher's server id for cancelCommand().
                const clientId = clientIdOf(requestId);
                if (
                    typeof clientId === "string" &&
                    typeof requestId?.requestId === "string"
                ) {
                    this.clientToServerRequestId.set(
                        clientId,
                        requestId.requestId,
                    );
                }
                this.broadcastToWebviews({
                    type: "setUserRequest",
                    requestId: clientId,
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
                    requestId: clientIdOf(requestId),
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
                    requestId: clientIdOf(message.requestId),
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
                    requestId: clientIdOf(message.requestId),
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
                this.broadcastToWebviews({
                    type: "notify",
                    event,
                    data,
                    source,
                    seq,
                    requestId: clientIdOf(notificationId),
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

    public notifyDemoState(
        running: boolean,
        paused: boolean,
        message?: string,
    ): void {
        this.broadcastToWebviews({
            type: "demoState",
            running,
            paused,
            message,
        });
    }

    /**
     * Live ClientIO event types that should be deferred while a history
     * replay is in progress. If the dispatcher emits one of these between
     * the time we start fetching display history and the time we broadcast
     * the assembled `historyReplay` message, sending it through immediately
     * would interleave it with (or render it before) the replayed history
     * — the webview can't tell the difference. We buffer them and flush
     * after the replay batch is on its way.
     */
    private static readonly REPLAY_BUFFERED_TYPES: ReadonlySet<string> =
        new Set([
            "setDisplay",
            "appendDisplay",
            "setDisplayInfo",
            "setUserRequest",
            "notify",
            "clear",
        ]);
    private replayBuffer: BridgeToWebviewMessage[] | undefined;

    private broadcastToWebviews(msg: BridgeToWebviewMessage): void {
        if (
            this.replayBuffer !== undefined &&
            AgentServerBridge.REPLAY_BUFFERED_TYPES.has(msg.type)
        ) {
            this.replayBuffer.push(msg);
            return;
        }
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
        this.reconnectAttempt++;
        // Backoff: 4s, 6s, 8s, ... capped at 30s. Quick first retries
        // recover fast when the server restarts; the cap keeps the
        // long-tail polite for genuinely-down servers.
        const backoff = Math.min(30, 2 + this.reconnectAttempt * 2);
        this.reconnectRemainingSec = backoff;
        this.broadcastReconnect("waiting");
        if (this.reconnectCountdown) {
            clearInterval(this.reconnectCountdown);
        }
        this.reconnectCountdown = setInterval(() => {
            if (this.reconnectRemainingSec === undefined) return;
            this.reconnectRemainingSec--;
            if (this.reconnectRemainingSec > 0) {
                this.broadcastReconnect("waiting");
            }
        }, 1000);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (this.reconnectCountdown) {
                clearInterval(this.reconnectCountdown);
                this.reconnectCountdown = undefined;
            }
            this.reconnectRemainingSec = undefined;
            this.broadcastReconnect("connecting");
            void this.connect();
        }, backoff * 1000);
    }

    private broadcastReconnect(
        phase: "waiting" | "connecting" | "cleared",
    ): void {
        this.broadcastToWebviews({
            type: "reconnectStatus",
            phase,
            attempt: this.reconnectAttempt,
            secondsRemaining:
                phase === "waiting" ? this.reconnectRemainingSec : undefined,
            error: this.lastConnectError,
        });
    }

    private clearReconnectState(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.reconnectCountdown) {
            clearInterval(this.reconnectCountdown);
            this.reconnectCountdown = undefined;
        }
        this.reconnectRemainingSec = undefined;
        this.reconnectAttempt = 0;
        this.lastConnectError = undefined;
        this.broadcastReconnect("cleared");
    }
}
