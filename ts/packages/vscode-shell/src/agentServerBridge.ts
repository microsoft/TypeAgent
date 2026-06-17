// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as os from "os";
import {
    connectAgentServer,
    type AgentServerConnection,
} from "@typeagent/agent-server-client";
import {
    findOrCreateNamedConversation,
    manageConversation,
    switchConversationSafe,
    type ConversationActionResult,
    type ManageConversationContext,
    type ManageConversationPayload,
} from "@typeagent/agent-server-client/conversation";
import { awaitCommand } from "@typeagent/dispatcher-types";
import { AGENT_SERVER_DEFAULT_URL } from "@typeagent/agent-server-protocol";
import type { ClientIO } from "@typeagent/dispatcher-rpc/types";

import {
    wrapLegacy,
    type LegacyAgentServerConnection,
    type SessionDispatcher,
} from "./bridge/shim.js";
import type {
    BridgeFromWebviewMessage,
    BridgeToWebviewMessage,
} from "./bridge/messages.js";
import { createBridgeClientIO } from "./bridge/clientIO.js";
import { clientIdOf } from "./bridge/requestIds.js";
import { toHistoryReplayMessage } from "./bridge/historyReplay.js";

import {
    createCompletionController,
    type CompletionController,
} from "agent-dispatcher/helpers/completion";
import type { CompletionDirection } from "@typeagent/agent-sdk";
import type {
    UserContext,
    ProcessCommandOptions,
} from "@typeagent/dispatcher-types";

// Internal-only message type unions; re-export for any future consumers.
export type {
    BridgeToWebviewMessage,
    BridgeFromWebviewMessage,
} from "./bridge/messages.js";

/** HTML-escape untrusted strings (names, ids, errors) for inline notification HTML. */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Replace `"name"` runs in helper messages with bold-escaped HTML so the
 * structured `ConversationActionResult.message` (plain text, with names
 * in double quotes) renders the same way the previous hand-written
 * messages did.
 */
function htmlizeManageMessage(message: string): string {
    return message.replace(
        /"([^"]+)"/g,
        (_, name) => `"<b>${escapeHtml(name)}</b>"`,
    );
}

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

    private connection: LegacyAgentServerConnection | undefined;
    private rawConnection: AgentServerConnection | undefined;
    /** In-flight connect promise — prevents parallel connect() races. */
    private connectInFlight: Promise<void> | undefined;
    /** In-flight session-join promise — serializes joinSpecificSession calls. */
    private joinInFlight: Promise<boolean> | undefined;
    private session: SessionDispatcher | undefined;
    private webviews: Set<vscode.Webview> = new Set();
    /**
     * Per-webview buffer for live broadcasts that arrive while the webview
     * is being hydrated (history fetch in flight). Without this buffer,
     * live setDisplay/appendDisplay events fired by the dispatcher during
     * the `await getDisplayHistory()` window would be applied immediately
     * by the webview, but the historyReplay message arrives later and is
     * applied on top — yielding out-of-order or duplicated transcripts.
     */
    private hydratingWebviews = new Map<
        vscode.Webview,
        BridgeToWebviewMessage[]
    >();
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
    /** Find-or-create fallback when no session is resolved by restore/ephemeral paths. */
    private readonly defaultSessionName: string | undefined;
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
        defaultSessionName?: string;
        displayName?: string;
        restoreSessionId?: string;
    }) {
        this.ownsStatusBar = opts?.ownsStatusBar ?? true;
        this.ephemeralSessionName = opts?.ephemeralSessionName;
        this.defaultSessionName = opts?.defaultSessionName;
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
        return {
            dispose: () => {
                this.onStatusChanged = undefined;
            },
        };
    }

    onWebviewFocus(cb: (focused: boolean) => void): vscode.Disposable {
        this.onWebviewFocusChanged = cb;
        return {
            dispose: () => {
                this.onWebviewFocusChanged = undefined;
            },
        };
    }

    /**
     * Register a webview to receive messages from the server.
     */
    registerWebview(webview: vscode.Webview): vscode.Disposable {
        this.webviews.add(webview);

        // Handle messages from the webview
        const disposable = webview.onDidReceiveMessage((msg) => {
            void this.handleWebviewMessage(msg, webview).catch((e) => {
                void this.handleWebviewMessageError(msg, e);
            });
        });

        // Send local user info so bubbles can show a real name/initial
        try {
            const name = os.userInfo().username;
            if (name) {
                this.postToWebview(webview, { type: "userInfo", name });
            }
        } catch {
            // os.userInfo() can throw on some configurations; ignore
        }

        // Send current status. Note: the webview's message listener may
        // not be wired up yet at this point (especially during VSIX
        // hot-reload, where the webview is restored from cache before
        // its bundle re-runs). The webview re-requests this state by
        // posting `connect` once it's ready — see hydrateWebview().
        this.postToWebview(webview, {
            type: "status",
            connected: this.isConnected,
            sessionId: this.session?.sessionId,
            sessionName: this.session ? this.getDisplayName() : undefined,
        });

        return {
            dispose: () => {
                this.webviews.delete(webview);
                this.hydratingWebviews.delete(webview);
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
            AGENT_SERVER_DEFAULT_URL,
        );

        try {
            this.rawConnection = await connectAgentServer(serverUrl, () => {
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
                this.clearRequestIdMaps();
                this.updateStatusBar(false);
                this.broadcastToWebviews({
                    type: "status",
                    connected: false,
                });
                this.onStatusChanged?.();
                this.scheduleReconnect();
            });
            this.connection = wrapLegacy(this.rawConnection);
            const connection = this.connection;
            const rawConnection = this.rawConnection;

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
                    if (
                        sessions.some(
                            (s) => s.sessionId === this.restoreSessionId,
                        )
                    ) {
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

            if (
                joinOpts.sessionId === undefined &&
                this.defaultSessionName !== undefined
            ) {
                // Find-or-create the named default (e.g. "VS Code"). Helper
                // handles the listConversations race retry internally.
                const info = await findOrCreateNamedConversation(
                    rawConnection,
                    this.defaultSessionName,
                );
                joinOpts.sessionId = info.conversationId;
            }

            this.session = await connection.joinSession(clientIO, joinOpts);

            AgentServerBridge.registerForSession(this.session.sessionId, this);

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
            await this.postSessionList();

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
            this.rawConnection = undefined;
            if (this.session) {
                AgentServerBridge.unregisterForSession(
                    this.session.sessionId,
                    this,
                );
            }
            this.session = undefined;
            this.clearRequestIdMaps();
            this.isConnected = false;
            this.updateStatusBar(false);
            this.broadcastToWebviews({ type: "status", connected: false });
            this.onStatusChanged?.();
        }
    }

    dispose(): void {
        // Synchronously clear timers and the static-map registration so
        // they can't leak past dispose, even if the async disconnect()
        // tail runs after the host has moved on.
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.reconnectCountdown) {
            clearInterval(this.reconnectCountdown);
            this.reconnectCountdown = undefined;
        }
        if (this.session) {
            AgentServerBridge.unregisterForSession(
                this.session.sessionId,
                this,
            );
        }

        // Best-effort delete the ephemeral session we created for this panel
        const toDelete = this.ephemeralSessionId;
        const conn = this.connection;
        if (toDelete && conn) {
            // Fire-and-forget — don't block dispose
            conn.deleteSession(toDelete)
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

    activateNewSessionInput(targetWebview?: vscode.Webview): void {
        const message: BridgeToWebviewMessage = {
            type: "activateNewSessionInput",
        };
        if (targetWebview) {
            this.postToWebview(targetWebview, message);
        } else {
            this.broadcastToWebviews(message);
        }
    }

    private async postSessionList(
        targetWebview?: vscode.Webview,
    ): Promise<void> {
        const post = (msg: BridgeToWebviewMessage) => {
            if (targetWebview) {
                this.postToWebview(targetWebview, msg);
            } else {
                this.broadcastToWebviews(msg);
            }
        };

        if (!this.connection || !this.isConnected) {
            post({
                type: "sessionList",
                sessions: [],
                currentSessionId: this.session?.sessionId,
            });
            return;
        }

        try {
            const sessions = await this.connection.listSessions();
            post({
                type: "sessionList",
                sessions: sessions.map((s) => ({
                    sessionId: s.sessionId,
                    name: s.name || s.sessionId.substring(0, 8),
                    clientCount: s.clientCount,
                    createdAt: s.createdAt,
                })),
                currentSessionId: this.session?.sessionId,
            });
        } catch (e) {
            console.warn("[agentServerBridge] listSessions failed:", e);
        }
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
        await this.postSessionList();
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
        this.broadcastToWebviews({
            type: "switching",
            switching: true,
            targetName: trimmed,
            statusLabel: "Creating",
        });
        const info = await this.connection.createSession(trimmed);
        await this.joinSpecificSession(info.sessionId, trimmed);
        vscode.window.showInformationMessage(
            `Created and switched to conversation "${trimmed}"`,
        );
        await this.postSessionList();
    }

    /**
     * Rename the current conversation.
     */
    async renameCurrentSession(newNameFromWebview?: string): Promise<void> {
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
        const validateName = (value: string): string | undefined => {
            const trimmed = value.trim();
            if (!trimmed) {
                return "Conversation name cannot be empty.";
            }
            if (existingNames.has(trimmed.toLowerCase())) {
                return `A conversation named "${trimmed}" already exists.`;
            }
            return undefined;
        };

        const newName =
            newNameFromWebview ??
            (await vscode.window.showInputBox({
                prompt: "New name for the current conversation",
                placeHolder: "My Conversation",
                validateInput: (value) => {
                    return validateName(value);
                },
            }));

        if (newName === undefined) {
            return;
        }

        const validationError = validateName(newName);
        if (validationError) {
            if (newNameFromWebview !== undefined) {
                throw new Error(validationError);
            }
            return;
        }
        const trimmed = newName.trim();

        await this.connection.renameSession(this.session.sessionId, trimmed);
        this.nameOverride = trimmed;
        this.broadcastToWebviews({
            type: "status",
            connected: true,
            sessionId: this.session.sessionId,
            sessionName: this.getDisplayName(),
        });
        this.onStatusChanged?.();
        await this.postSessionList();
        if (newNameFromWebview === undefined) {
            vscode.window.showInformationMessage(
                `Renamed conversation to "${trimmed}"`,
            );
        }
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
            await this.postSessionList();
        }
    }

    /**
     * Switch to a different conversation using join-before-leave:
     *   1. join the new session (on failure, old session is still active),
     *   2. leave the old session (best-effort),
     *   3. replay the new session's display history.
     *
     * Returns true on success, false if the new-session join failed (error
     * toast already shown). Most legacy callers discard the return; the
     * `manage-conversation` handlers consume it to suppress a false-success
     * notification when the join failed.
     */
    private async joinSpecificSession(
        sessionId: string,
        targetName?: string,
    ): Promise<boolean> {
        this.isSwitching = true;
        this.broadcastToWebviews({
            type: "switching",
            switching: true,
            targetName,
            statusLabel: "Connecting",
        });
        try {
            return await this.runSerializedSessionJoin(sessionId);
        } finally {
            this.isSwitching = false;
            this.broadcastToWebviews({
                type: "switching",
                switching: false,
            });
        }
    }

    private async runSerializedSessionJoin(
        sessionId: string,
    ): Promise<boolean> {
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
            return true;
        }
        if (!this.connection) {
            return false;
        }
        const p = this.performSessionJoin(sessionId);
        this.joinInFlight = p.finally(() => {
            if (this.joinInFlight === p) {
                this.joinInFlight = undefined;
            }
        });
        return this.joinInFlight;
    }

    private async performSessionJoin(sessionId: string): Promise<boolean> {
        if (!this.connection || !this.rawConnection) {
            return false;
        }
        const rawConnection = this.rawConnection;

        const clientIO = this.createClientIO();
        const oldSessionId = this.session?.sessionId;
        const ephemeralIdAtStart = this.ephemeralSessionId;
        let newSession: SessionDispatcher | undefined;

        const result = await switchConversationSafe(
            rawConnection,
            clientIO,
            oldSessionId,
            sessionId,
            {
                onJoined: (joined) => {
                    newSession = this.applySessionJoinedRebindOnly(
                        joined,
                        oldSessionId,
                    );
                },
                onLeftOld: async (leftId) => {
                    await this.deleteEphemeralIfLeft(
                        leftId,
                        ephemeralIdAtStart,
                        sessionId,
                        rawConnection,
                    );
                    // Broadcasts and replay run post-leave so late
                    // events from the old conversation can't render
                    // after the UI has switched.
                    if (newSession) {
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
                    }
                },
            },
            {
                clientType: "extension",
                filter: false,
            },
        );

        if (result.kind === "join-failed") {
            const e = result.error as { message?: string } | undefined;
            vscode.window.showErrorMessage(
                `Failed to switch conversation: ${e?.message ?? String(result.error)}`,
            );
            return false;
        }

        // No-current-session case: switchConversationSafe doesn't
        // fire onLeftOld when there was nothing to leave, so flush
        // the broadcasts/replay here.
        if (oldSessionId === undefined && newSession) {
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
        }
        return true;
    }

    private async joinSpecificSessionOrThrow(
        sessionId: string,
        targetName?: string,
        failureMessage?: string,
    ): Promise<void> {
        const switched = await this.runSerializedSessionJoin(sessionId);
        if (!switched) {
            throw new Error(
                failureMessage ??
                    (targetName
                        ? `Failed to switch to conversation "${targetName}".`
                        : "Failed to switch conversation."),
            );
        }
    }

    // Rebind-only variant: state mutation + registry swap, no broadcasts.
    // Used by the manage-conversation path which fires broadcasts from
    // onAfterSwitched so they happen after the old conversation is left,
    // avoiding cross-conversation event leakage.
    private applySessionJoinedRebindOnly(
        joined: {
            dispatcher: SessionDispatcher["dispatcher"];
            conversationId: string;
            name: string;
        },
        oldSessionId: string | undefined,
    ): SessionDispatcher {
        const newSession: SessionDispatcher = {
            dispatcher: joined.dispatcher,
            sessionId: joined.conversationId,
            name: joined.name,
        };
        this.session = newSession;
        this.clearRequestIdMaps();
        this.nameOverride = undefined;
        if (oldSessionId) {
            AgentServerBridge.unregisterForSession(oldSessionId, this);
        }
        AgentServerBridge.registerForSession(joined.conversationId, this);
        return newSession;
    }

    private async deleteEphemeralIfLeft(
        leftId: string,
        ephemeralAtStart: string | undefined,
        newSessionId: string,
        rawConnection: AgentServerConnection,
    ): Promise<void> {
        if (
            ephemeralAtStart &&
            leftId === ephemeralAtStart &&
            newSessionId !== ephemeralAtStart
        ) {
            this.ephemeralSessionId = undefined;
            try {
                await rawConnection.deleteConversation(ephemeralAtStart);
            } catch {
                // Best effort
            }
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
        this.replayBufferOverflowed = false;
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
        // historyReplay is not in REPLAY_BUFFERED_TYPES so this passes
        // through immediately.
        this.broadcastToWebviews(toHistoryReplayMessage(entries));
        this.flushReplayBuffer();
    }

    /**
     * Re-send userInfo, current status, and replayed history to a single
     * webview that has just (re-)attached its message listener. Triggered
     * by the webview posting `connect` while the bridge is already
     * connected — typically a VSIX hot-reload or webview restore where
     * the webview missed the eager broadcasts from registerWebview().
     *
     * Posts directly to the requesting webview only so peer webviews
     * don't see duplicate userInfo/status/history messages.
     */
    private hydrateWebview(webview: vscode.Webview): void {
        try {
            const name = os.userInfo().username;
            if (name) {
                this.postToWebview(webview, { type: "userInfo", name });
            }
        } catch {
            // os.userInfo() can throw on some configurations; ignore
        }

        this.postToWebview(webview, {
            type: "status",
            connected: this.isConnected,
            sessionId: this.session?.sessionId,
            sessionName: this.session ? this.getDisplayName() : undefined,
        });

        const session = this.session;
        if (!session) return;

        // Fire-and-forget: fetch history and post to this webview only.
        // We deliberately do NOT engage the global replay buffer here —
        // peers are mid-conversation and shouldn't have their live events
        // paused for a single webview's reload hydration. Instead we
        // queue live broadcasts destined for THIS webview only via
        // `hydratingWebviews`, draining the queue after historyReplay
        // is posted so the transcript stays ordered.
        this.hydratingWebviews.set(webview, []);
        void (async () => {
            this.postToWebview(webview, {
                type: "historyLoading",
                loading: true,
            });
            try {
                const entries = await session.dispatcher.getDisplayHistory();
                if (entries.length > 0) {
                    this.postToWebview(
                        webview,
                        toHistoryReplayMessage(entries),
                    );
                }
                // Also seed the webview's QueueStateMirror with the current
                // snapshot so double-Esc / queue-aware UI has a baseline
                // before the next push event arrives. Best-effort: a missing
                // getQueueSnapshot (older dispatcher) is silently skipped.
                try {
                    if (
                        typeof session.dispatcher.getQueueSnapshot ===
                        "function"
                    ) {
                        const snap =
                            await session.dispatcher.getQueueSnapshot();
                        if (snap) {
                            this.postToWebview(webview, {
                                type: "queueStateChanged",
                                snapshot: snap,
                            });
                        }
                    }
                } catch (e) {
                    console.warn(
                        "[agentServerBridge] hydrateWebview queue snapshot failed:",
                        e,
                    );
                }
            } catch (e) {
                console.warn(
                    "[agentServerBridge] hydrateWebview replay failed:",
                    e,
                );
            } finally {
                this.postToWebview(webview, {
                    type: "historyLoading",
                    loading: false,
                });
                // Drain any live broadcasts that arrived during hydration
                // and stop intercepting future broadcasts for this webview.
                const queued = this.hydratingWebviews.get(webview) ?? [];
                this.hydratingWebviews.delete(webview);
                for (const m of queued) {
                    this.postToWebview(webview, m);
                }
            }
        })();
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
        webview: vscode.Webview,
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
                    const mapped = this.clientToServerRequestId.get(
                        msg.requestId,
                    );
                    const serverId = mapped ?? msg.requestId;
                    this.session?.dispatcher.cancelCommand(serverId);
                } catch (e) {
                    console.warn(
                        "[agentServerBridge] cancelCommand failed:",
                        e,
                    );
                }
                break;
            case "promoteCommand":
                // "Jump the queue": move a queued request to the front so it
                // runs next. Same client→server requestId translation as
                // cancelCommand (the webview only knows its clientRequestId).
                try {
                    const mapped = this.clientToServerRequestId.get(
                        msg.requestId,
                    );
                    const serverId = mapped ?? msg.requestId;
                    void this.session?.dispatcher.promoteCommand(serverId);
                } catch (e) {
                    console.warn(
                        "[agentServerBridge] promoteCommand failed:",
                        e,
                    );
                }
                break;
            case "cancelAllQueuedAndRunning":
                // Double-Esc gesture from the webview: cancel every queued
                // and running entry on this session. Mirrors the Electron
                // shell's `ChatView.cancelAllQueuedAndRunning` (chatView.ts:462).
                // Prefer the authoritative queue snapshot — it includes
                // peer-originated entries the local clientToServerRequestId
                // map doesn't know about. Fall back to that map only when
                // the snapshot is unavailable (older dispatcher contract).
                await this.cancelAllQueuedAndRunning();
                break;
            case "openExternal":
                // Webviews can't open arbitrary external URLs; route through
                // the extension host so VS Code applies its trust prompt.
                if (msg.href) {
                    void vscode.env.openExternal(vscode.Uri.parse(msg.href));
                }
                break;
            case "connect":
                // The webview posts `connect` once it has wired up its
                // message listener — this is also our cue that it's ready
                // to receive state. On a webview reload the bridge is
                // already connected, so connect() is a no-op; we still
                // need to (re-)hydrate the just-loaded webview with
                // userInfo, current status, and replayed history.
                if (this.isConnected && this.session) {
                    this.hydrateWebview(webview);
                } else {
                    await this.connect();
                }
                break;
            case "disconnect":
                await this.disconnect();
                break;
            case "getStatus":
                this.broadcastToWebviews({
                    type: "status",
                    connected: this.isConnected,
                    sessionId: this.session?.sessionId,
                    sessionName: this.session
                        ? this.getDisplayName()
                        : undefined,
                });
                break;
            case "requestSessions":
                await this.postSessionList(webview);
                break;
            case "createSession":
                await this.createSessionFromWebview(msg.name);
                break;
            case "switchSession":
                await this.switchSessionFromWebview(msg.sessionId);
                break;
            case "renameCurrentSession":
                await this.renameCurrentSession(msg.name);
                break;
            case "deleteCurrentSession":
                await this.deleteCurrentSessionFromWebview();
                break;
            case "renameSession":
                await this.renameSessionFromWebview(msg.sessionId, msg.name);
                break;
            case "deleteSession":
                await this.deleteSessionFromWebview(msg.sessionId);
                break;
            case "focus":
                this.onWebviewFocusChanged?.(msg.focused);
                break;
            case "pcUpdate":
                this.pcUpdate(webview, msg.input, msg.direction);
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
            case "demoLineCancelled": {
                // Webview's typeAndSend bailed mid-animation in response
                // to a cancelTyping signal; release the matching demo
                // runner await so the script's loop can see the cancel
                // and exit cleanly instead of hanging on this requestId.
                const resolve = this.demoCompletionResolvers.get(msg.requestId);
                if (resolve) {
                    this.demoCompletionResolvers.delete(msg.requestId);
                    resolve();
                }
                break;
            }
        }
    }

    /**
     * Tell every connected webview to abort an in-flight typing animation.
     * Called from the demo cancel path so the current line stops typing
     * immediately instead of completing first.
     */
    public broadcastCancelTyping(): void {
        this.broadcastToWebviews({ type: "demoCancelTyping" });
    }

    /**
     * Cancel every in-flight dispatcher request currently tracked by
     * this bridge. Called from the demo cancel path so Esc interrupts
     * the command that's executing on the server side, not just the
     * pre-dispatch typing animation.
     */
    public cancelAllInFlight(): void {
        if (!this.session) return;
        const ids = Array.from(new Set(this.clientToServerRequestId.values()));
        for (const serverId of ids) {
            try {
                this.session.dispatcher.cancelCommand(serverId);
            } catch (e) {
                console.warn(
                    "[agentServerBridge] cancelAllInFlight cancel failed:",
                    e,
                );
            }
        }
    }

    /**
     * Cancel every queued AND running entry on this session's queue. Backs
     * the webview's double-Esc gesture and mirrors `ChatView.cancelAllQueuedAndRunning`
     * in the Electron shell (chatView.ts:462).
     *
     * Prefers the authoritative queue snapshot so peer-originated entries
     * (which this bridge never saw a setUserRequest for) are also cancelled.
     * Falls back to the local clientToServerRequestId map only when the
     * snapshot is unavailable (older dispatcher, transient error). Per-id
     * errors are swallowed so one dead call doesn't strand the rest — the
     * server's requestCancelled broadcast still drives UI updates.
     */
    public async cancelAllQueuedAndRunning(): Promise<void> {
        const session = this.session;
        if (!session) return;
        const ids = new Set<string>();
        try {
            if (typeof session.dispatcher.getQueueSnapshot === "function") {
                const snap = await session.dispatcher.getQueueSnapshot();
                if (snap?.running) ids.add(snap.running.requestId);
                for (const entry of snap?.queued ?? []) {
                    ids.add(entry.requestId);
                }
            }
        } catch (e) {
            console.warn(
                "[agentServerBridge] cancelAllQueuedAndRunning getQueueSnapshot failed:",
                e,
            );
        }
        // Degraded fallback (and belt-and-suspenders for races): also pull
        // any ids the bridge has tracked locally that the snapshot missed.
        for (const serverId of this.clientToServerRequestId.values()) {
            ids.add(serverId);
        }
        if (ids.size === 0) return;
        await Promise.all(
            Array.from(ids).map(async (serverId) => {
                try {
                    await Promise.resolve(
                        session.dispatcher.cancelCommand(serverId),
                    );
                } catch (e) {
                    console.warn(
                        `[agentServerBridge] cancelAllQueuedAndRunning(${serverId}) failed:`,
                        e,
                    );
                }
            }),
        );
    }

    private ensureCompletionController(
        webview: vscode.Webview,
    ): CompletionController | undefined {
        if (!this.session) return undefined;
        if (this.completionController && this.completionWebview === webview) {
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

        const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
        const base = `${this.displayName} ${stamp}`;
        let name = base;
        try {
            const sessions = await this.connection.listSessions();
            const taken = new Set(sessions.map((s) => s.name));
            let n = 2;
            while (taken.has(name)) {
                name = `${base} (${n++})`;
            }
            await this.connection.renameSession(this.session.sessionId, name);
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
    /**
     * Reverse direction of `clientToServerRequestId`. The dispatcher's queue
     * lifecycle ClientIO events (requestQueued / requestStarted / requestCancelled)
     * carry the canonical SERVER requestId, but chat-ui keys bubbles by the
     * clientRequestId — so the bridge looks up the alias here before forwarding
     * to the webview. Populated alongside the forward map in setUserRequest.
     */
    private serverToClientRequestId = new Map<string, string>();

    /**
     * Wipe both cross-ref maps. Called on session change / disconnect —
     * the old session's queued and in-flight requestIds are no longer
     * valid against the dispatcher we'll be talking to next, and
     * holding them risks routing a future cancelCommand at a stale id.
     */
    private clearRequestIdMaps(): void {
        this.clientToServerRequestId.clear();
        this.serverToClientRequestId.clear();
    }

    /**
     * Gather user context from VS Code (active editor, workspace, etc.)
     */
    private gatherUserContext(): UserContext {
        const activeEditor = vscode.window.activeTextEditor;
        const activeWorkspaceFolder =
            vscode.workspace.workspaceFolders?.[0]?.name ?? undefined;

        // Build description from active document/language
        let activeAppDescription: string | undefined;
        if (activeEditor) {
            const languageId = activeEditor.document.languageId;
            const fileName =
                activeEditor.document.fileName.split(/[\\/]/).pop() ?? "file";
            activeAppDescription = `${fileName} (${languageId})`;
        } else if (activeWorkspaceFolder) {
            activeAppDescription = `Project: ${activeWorkspaceFolder}`;
        }

        return {
            activeApp: "vscode",
            activeAppDescription,
        };
    }

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
                message:
                    "No active session — reconnect or pick a conversation.",
                requestId: requestId ?? "",
            });
            return;
        }

        try {
            const userContext = this.gatherUserContext();
            const options: ProcessCommandOptions = {
                userContext,
            };
            const result = await awaitCommand(
                this.session.dispatcher,
                command,
                undefined,
                options,
                requestId,
            );
            // Command finished — tell webview to clean up temporary status
            this.broadcastToWebviews({
                type: "commandComplete",
                requestId: requestId ?? "",
                result: result ?? null,
                aliasRequestId: requestId
                    ? this.clientToServerRequestId.get(requestId)
                    : undefined,
            });
            // Forward metrics to peer tabs sharing this session so their
            // bubbles for this requestId also pick up the timing tooltip.
            this.broadcastMetricsToPeers(requestId, result ?? null);
        } catch (e: any) {
            this.broadcastToWebviews({
                type: "commandComplete",
                requestId: requestId ?? "",
                result: null,
                aliasRequestId: requestId
                    ? this.clientToServerRequestId.get(requestId)
                    : undefined,
            });
            this.broadcastToWebviews({
                type: "error",
                message: e?.message ?? String(e),
                requestId: requestId,
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
                const serverId = this.clientToServerRequestId.get(requestId);
                this.clientToServerRequestId.delete(requestId);
                if (serverId !== undefined) {
                    this.serverToClientRequestId.delete(serverId);
                }
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
        return createBridgeClientIO({
            broadcast: (msg) => this.broadcastToWebviews(msg),
            rememberServerRequestId: (clientId, serverId) => {
                this.clientToServerRequestId.set(clientId, serverId);
                this.serverToClientRequestId.set(serverId, clientId);
            },
            lookupClientRequestId: (serverId) =>
                this.serverToClientRequestId.get(serverId),
            lookupServerRequestId: (clientId) =>
                this.clientToServerRequestId.get(clientId),
            forgetRequestId: (serverId) => {
                const clientId = this.serverToClientRequestId.get(serverId);
                this.serverToClientRequestId.delete(serverId);
                if (clientId !== undefined) {
                    // Only delete the forward entry if it still points at the
                    // serverId we're forgetting — otherwise a subsequent
                    // setUserRequest may have re-bound the client rid to a
                    // newer serverId and we'd strand its mapping.
                    if (
                        this.clientToServerRequestId.get(clientId) === serverId
                    ) {
                        this.clientToServerRequestId.delete(clientId);
                    }
                }
            },
            sweepRequestIds: (liveServerIds) => {
                for (const serverId of Array.from(
                    this.serverToClientRequestId.keys(),
                )) {
                    if (liveServerIds.has(serverId)) continue;
                    const clientId = this.serverToClientRequestId.get(serverId);
                    this.serverToClientRequestId.delete(serverId);
                    if (
                        clientId !== undefined &&
                        this.clientToServerRequestId.get(clientId) === serverId
                    ) {
                        this.clientToServerRequestId.delete(clientId);
                    }
                }
            },
            handleShellAction: (requestId, data) =>
                this.handleShellAction(requestId, data),
            handleManageConversation: (requestId, data) =>
                this.handleManageConversation(requestId, data),
        });
    }

    /**
     * Replace the action bubble body for `requestId` — used when the actual
     * outcome differs from the optimistic action-handler reply, and for
     * non-switching `manage-conversation` results that render inline.
     */
    private overwriteActionBubble(
        requestId: any,
        body:
            | string
            | {
                  type: "html" | "markdown" | "text";
                  content: string;
                  kind?: "info" | "warning" | "error" | "success";
              },
        source: string = "code.code-vscode-shell",
    ): void {
        this.broadcastToWebviews({
            type: "setDisplay",
            requestId: clientIdOf(requestId),
            message: {
                message: body as any,
                source,
                requestId,
            } as any,
        });
    }

    /**
     * Push an agent-style notification bubble into the currently displayed
     * conversation. Used by switching `manage-conversation` handlers — the
     * request bubble belongs to the old conversation and gets wiped by
     * `chatPanel.clear()` on sessionChanged. `content` must be pre-escaped.
     */
    private displayConversationNotification(
        content: string,
        kind: "info" | "warning" | "error" | "success" = "info",
    ): void {
        this.broadcastToWebviews({
            type: "conversationNotification",
            content,
            kind,
        });
    }

    /**
     * Handle a "vscode-shell-action" routed from the code agent. Targeted
     * to the originating client by the agent server's takeAction routing,
     * so only this bridge (the originator's bridge) receives it.
     */
    private async handleShellAction(requestId: any, data: any): Promise<void> {
        if (!data || typeof data !== "object") return;
        const actionName = data.actionName as string | undefined;
        const params = (data.parameters ?? {}) as {
            name?: string;
            newName?: string;
        };

        switch (actionName) {
            case "newConversation":
                await this.newConversationFromAgent(requestId, params.name);
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
            case "deleteConversation":
                await this.deleteConversationFromAgent(requestId, params.name);
                break;
        }
    }

    /**
     * Create a new conversation programmatically (from a chat-issued
     * action). If `name` is omitted, falls back to the interactive prompt.
     */
    private async newConversationFromAgent(
        requestId: any,
        name?: string,
    ): Promise<void> {
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
            this.overwriteActionBubble(
                requestId,
                `A conversation named "${trimmed}" already exists. Switching to it instead of creating a new one.`,
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
     * the interactive picker if no name was provided. If a name is given
     * but no conversation matches, creates a new conversation with that
     * name and switches to it.
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
            // Create-on-switch: user asked to switch to a conversation
            // that doesn't exist yet, so create it and switch to it.
            const info = await this.connection.createSession(trimmed);
            await this.joinSpecificSession(info.sessionId, trimmed);
            vscode.window.showInformationMessage(
                `Created and switched to new conversation "${trimmed}".`,
            );
            return;
        }
        if (match.sessionId === this.session?.sessionId) {
            return;
        }
        await this.joinSpecificSession(match.sessionId, match.name);
    }

    /**
     * Delete a conversation by display name (from chat). Prompts the user
     * for confirmation before deleting. Falls back to the interactive
     * picker if no name was provided. Refuses to delete the currently
     * active conversation.
     */
    private async deleteConversationFromAgent(
        requestId: any,
        name?: string,
    ): Promise<void> {
        if (!this.connection) {
            vscode.window.showWarningMessage("Not connected to agent server.");
            return;
        }
        if (!name || !name.trim()) {
            await this.deleteSession();
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
            this.overwriteActionBubble(
                requestId,
                `No conversation named "${trimmed}" found to delete.`,
            );
            return;
        }
        if (match.sessionId === this.session?.sessionId) {
            vscode.window.showWarningMessage(
                `Cannot delete the currently active conversation "${trimmed}".`,
            );
            this.overwriteActionBubble(
                requestId,
                `Cannot delete the currently active conversation "${match.name}". Switch to a different conversation first.`,
            );
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete conversation "${match.name}"? This cannot be undone.`,
            { modal: true },
            "Delete",
        );
        if (confirm !== "Delete") {
            this.overwriteActionBubble(
                requestId,
                `Delete of conversation "${match.name}" was cancelled.`,
            );
            return;
        }

        await this.connection.deleteSession(match.sessionId);
        vscode.window.showInformationMessage(
            `Deleted conversation "${match.name}".`,
        );
        this.onStatusChanged?.();
    }

    // manage-conversation handler — routed from NL and `@conversation` slash
    // commands. See ts/docs/architecture/agentServerConversations.md.
    private async handleManageConversation(
        requestId: any,
        payload: any,
    ): Promise<void> {
        if (!payload || typeof payload !== "object") return;
        if (!this.connection || !this.rawConnection) {
            this.overwriteActionBubble(
                requestId,
                {
                    type: "html",
                    content: "Not connected to agent server.",
                    kind: "warning",
                },
                "conversation",
            );
            return;
        }

        const willSwitch =
            payload.subcommand === "new" ||
            payload.subcommand === "switch" ||
            payload.subcommand === "next" ||
            payload.subcommand === "prev";

        // Serialize switch-causing manage ops against in-flight direct
        // joins (joinSpecificSession) so two switches can't race and
        // both pass each other's no-op guards.
        if (willSwitch && this.joinInFlight) {
            try {
                await this.joinInFlight;
            } catch {
                // Previous join failed — proceed with our own.
            }
        }
        const p = this.handleManageConversationImpl(
            requestId,
            payload,
            willSwitch,
        );
        if (willSwitch) {
            this.joinInFlight = p.then(
                () => true,
                () => false,
            );
            const tracker = this.joinInFlight;
            tracker.finally(() => {
                if (this.joinInFlight === tracker) {
                    this.joinInFlight = undefined;
                }
            });
        }
        return p;
    }

    private async handleManageConversationImpl(
        requestId: any,
        payload: any,
        willSwitch: boolean,
    ): Promise<void> {
        if (!this.connection || !this.rawConnection) return;
        const rawConnection = this.rawConnection;
        const oldSessionId = this.session?.sessionId;
        const oldSession = this.session;
        const ephemeralIdAtStart = this.ephemeralSessionId;
        let joinedSession: SessionDispatcher | undefined;
        let switchTargetName: string | undefined;

        if (willSwitch) {
            this.isSwitching = true;
            this.broadcastToWebviews({
                type: "switching",
                switching: true,
                statusLabel: "Connecting",
            });
        }

        const ctx: ManageConversationContext = {
            currentConversationId: oldSessionId,
            currentConversationName: this.session?.name,
            getCurrentConversationId: () => this.session?.sessionId,
            // Pre-leave: rebind dispatcher + local state only. Broadcasts
            // and replay must wait until the old conversation is left to
            // avoid rendering its lingering events into the new UI.
            // Local rollback is in-hook because manageConversation
            // catches throws and returns an error result — the outer
            // catch below would not see them.
            onSwitched: (joined) => {
                try {
                    joinedSession = this.applySessionJoinedRebindOnly(
                        joined,
                        oldSessionId,
                    );
                    switchTargetName = joined.name;
                } catch (e) {
                    if (oldSession !== undefined) {
                        this.session = oldSession;
                        AgentServerBridge.unregisterForSession(
                            joined.conversationId,
                            this,
                        );
                        AgentServerBridge.registerForSession(
                            oldSession.sessionId,
                            this,
                        );
                    }
                    joinedSession = undefined;
                    throw e;
                }
            },
            // Post-leave: safe for broadcasts and history replay.
            onAfterSwitched: async () => {
                if (!joinedSession) return;
                if (oldSessionId !== undefined) {
                    await this.deleteEphemeralIfLeft(
                        oldSessionId,
                        ephemeralIdAtStart,
                        joinedSession.sessionId,
                        rawConnection,
                    );
                }
                this.broadcastToWebviews({
                    type: "sessionChanged",
                    sessionId: joinedSession.sessionId,
                    sessionName: this.getDisplayName(),
                });
                this.broadcastToWebviews({
                    type: "status",
                    connected: true,
                    sessionId: joinedSession.sessionId,
                    sessionName: this.getDisplayName(),
                });
                this.onStatusChanged?.();
                await this.replayHistory(joinedSession);
                this.lastReplayedSessionId = joinedSession.sessionId;
            },
            // Helper rolls back the *server-side* join on rebind failure;
            // onSwitched above restores local state in-hook.
            onCurrentConversationUpdated: () => {},
            joinOptions: { clientType: "extension", filter: false },
            // VS Code cycles in server-listing order to match its
            // pre-migration UX (the QuickPick uses the same order).
            cycleOrder: "server-order",
        };

        try {
            const result = await manageConversation(
                rawConnection,
                this.createClientIO(),
                ctx,
                payload as ManageConversationPayload,
            );

            this.renderManageResult(requestId, result, switchTargetName);

            if (
                payload.subcommand === "rename" &&
                result.kind === "ok" &&
                result.conversation !== undefined &&
                result.conversation.conversationId ===
                    this.session?.sessionId &&
                this.session
            ) {
                this.nameOverride = result.conversation.name;
                this.broadcastToWebviews({
                    type: "status",
                    connected: true,
                    sessionId: this.session.sessionId,
                    sessionName: this.getDisplayName(),
                });
                this.onStatusChanged?.();
            } else if (
                payload.subcommand === "delete" &&
                result.kind === "ok"
            ) {
                this.onStatusChanged?.();
            }
            await this.postSessionList();
        } catch (e: any) {
            // Helper rolled back its server-side join — restore our local
            // state to whatever it was before onSwitched ran.
            if (joinedSession && oldSession !== undefined) {
                this.session = oldSession;
                AgentServerBridge.unregisterForSession(
                    joinedSession.sessionId,
                    this,
                );
                AgentServerBridge.registerForSession(
                    oldSession.sessionId,
                    this,
                );
            }

            const msg = e?.message ?? String(e);
            this.overwriteActionBubble(
                requestId,
                {
                    type: "html",
                    content: `❌ ${escapeHtml(msg)}`,
                    kind: "error",
                },
                "conversation",
            );
        } finally {
            if (willSwitch) {
                this.isSwitching = false;
                this.broadcastToWebviews({
                    type: "switching",
                    switching: false,
                });
            }
        }
    }

    private async createSessionFromWebview(name: string): Promise<void> {
        if (!this.connection) {
            throw new Error("Not connected to agent server.");
        }
        const trimmed = name.trim();
        if (!trimmed) {
            throw new Error("Conversation name cannot be empty.");
        }
        const sessions = await this.connection.listSessions();
        const existing = sessions.find(
            (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (existing) {
            await this.transitionToSessionFromWebview(
                existing.name,
                "switch",
                existing.sessionId,
            );
            return;
        }
        await this.transitionToSessionFromWebview(
            trimmed,
            "create",
            undefined,
            `Created conversation "${trimmed}" but failed to switch to it.`,
        );
    }

    private async transitionToSessionFromWebview(
        targetName: string,
        mode: "create" | "switch",
        sessionId?: string,
        failureMessage?: string,
        refreshSessionList = true,
    ): Promise<void> {
        const statusLabel = mode === "create" ? "Creating" : "Connecting";
        this.isSwitching = true;
        this.broadcastToWebviews({
            type: "switching",
            switching: true,
            targetName,
            statusLabel,
        });
        try {
            const targetSessionId =
                mode === "create"
                    ? (await this.connection!.createSession(targetName))
                          .sessionId
                    : sessionId;
            if (!targetSessionId) {
                throw new Error("No conversation selected.");
            }
            await this.joinSpecificSessionOrThrow(
                targetSessionId,
                targetName,
                failureMessage,
            );
        } finally {
            this.isSwitching = false;
            this.broadcastToWebviews({
                type: "switching",
                switching: false,
            });
            if (refreshSessionList) {
                await this.postSessionList().catch((e) => {
                    console.warn(
                        "[agentServerBridge] postSessionList after transition failed:",
                        e,
                    );
                });
            }
        }
    }

    private async handleWebviewMessageError(
        msg: BridgeFromWebviewMessage,
        e: unknown,
    ): Promise<void> {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[agentServerBridge] webview message failed:", e);

        if (this.isSessionMutationMessage(msg)) {
            await this.postSessionList().catch((listError) => {
                console.warn(
                    "[agentServerBridge] postSessionList after failure failed:",
                    listError,
                );
            });
            this.broadcastToWebviews({
                type: "sessionError",
                message,
            });
            return;
        }

        vscode.window.showWarningMessage(message);
    }

    private isSessionMutationMessage(msg: BridgeFromWebviewMessage): boolean {
        switch (msg.type) {
            case "createSession":
            case "switchSession":
            case "renameCurrentSession":
            case "deleteCurrentSession":
            case "renameSession":
            case "deleteSession":
                return true;
            default:
                return false;
        }
    }

    private async switchSessionFromWebview(sessionId: string): Promise<void> {
        if (!this.connection) {
            throw new Error("Not connected to agent server.");
        }
        if (!sessionId) {
            throw new Error("No conversation selected.");
        }
        if (sessionId === this.session?.sessionId) {
            this.broadcastToWebviews({
                type: "switching",
                switching: false,
            });
            return;
        }
        const sessions = await this.connection.listSessions();
        const target = sessions.find((s) => s.sessionId === sessionId);
        if (!target) {
            throw new Error("Selected conversation no longer exists.");
        }
        await this.transitionToSessionFromWebview(
            target.name,
            "switch",
            target.sessionId,
        );
    }

    private async deleteCurrentSessionFromWebview(): Promise<void> {
        if (!this.connection || !this.session) {
            throw new Error("No active conversation.");
        }

        const currentId = this.session.sessionId;
        const currentName = this.session.name || currentId.substring(0, 8);
        const confirm = await vscode.window.showWarningMessage(
            `Delete current conversation "${currentName}"? This cannot be undone.`,
            { modal: true },
            "Delete",
        );
        if (confirm !== "Delete") {
            return;
        }

        const sessions = await this.connection.listSessions();
        const fallback = sessions.find((s) => s.sessionId !== currentId);

        if (fallback) {
            await this.transitionToSessionFromWebview(
                fallback.name,
                "switch",
                fallback.sessionId,
                `Failed to switch to conversation "${fallback.name}" before deleting the current conversation.`,
                false,
            );
        } else {
            const taken = new Set(sessions.map((s) => s.name.toLowerCase()));
            const base = "New Conversation";
            let name = base;
            let suffix = 2;
            while (taken.has(name.toLowerCase())) {
                name = `${base} ${suffix++}`;
            }
            await this.transitionToSessionFromWebview(
                name,
                "create",
                undefined,
                `Created conversation "${name}" but failed to switch to it before deleting the current conversation.`,
                false,
            );
        }

        await this.connection.deleteSession(currentId);
        if (this.ephemeralSessionId === currentId) {
            this.ephemeralSessionId = undefined;
        }
        vscode.window.showInformationMessage(
            `Deleted conversation "${currentName}"`,
        );
        await this.postSessionList();
    }

    private async renameSessionFromWebview(
        sessionId: string,
        newName: string,
    ): Promise<void> {
        if (!this.connection) {
            throw new Error("Not connected to agent server.");
        }
        const trimmed = newName.trim();
        if (!trimmed) {
            throw new Error("Conversation name cannot be empty.");
        }

        const sessions = await this.connection.listSessions();
        const target = sessions.find((s) => s.sessionId === sessionId);
        if (!target) {
            throw new Error("Selected conversation no longer exists.");
        }

        const collision = sessions.find(
            (s) =>
                s.sessionId !== sessionId &&
                s.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (collision) {
            throw new Error(
                `A conversation named "${trimmed}" already exists.`,
            );
        }

        await this.connection.renameSession(sessionId, trimmed);
        if (this.session?.sessionId === sessionId) {
            this.nameOverride = trimmed;
            this.broadcastToWebviews({
                type: "status",
                connected: true,
                sessionId,
                sessionName: this.getDisplayName(),
            });
            this.onStatusChanged?.();
        }
        await this.postSessionList();
    }

    private async deleteSessionFromWebview(sessionId: string): Promise<void> {
        if (!this.connection) {
            throw new Error("Not connected to agent server.");
        }
        if (!sessionId) {
            throw new Error("No conversation selected.");
        }
        if (this.session?.sessionId === sessionId) {
            await this.deleteCurrentSessionFromWebview();
            return;
        }

        const sessions = await this.connection.listSessions();
        const target = sessions.find((s) => s.sessionId === sessionId);
        if (!target) {
            throw new Error("Selected conversation no longer exists.");
        }

        const targetName = target.name || target.sessionId.substring(0, 8);
        const confirm = await vscode.window.showWarningMessage(
            `Delete conversation "${targetName}"? This cannot be undone.`,
            { modal: true },
            "Delete",
        );
        if (confirm !== "Delete") {
            return;
        }

        await this.connection.deleteSession(sessionId);
        await this.postSessionList();
    }

    // Map a structured ConversationActionResult to the bridge's two
    // display surfaces — inline action-bubble overwrite for non-switching
    // results, conversation-notification banner for switching results
    // (the request bubble belongs to the old conversation and gets
    // cleared on sessionChanged).
    private renderManageResult(
        requestId: any,
        result: ConversationActionResult,
        _switchTargetName?: string,
    ): void {
        switch (result.kind) {
            case "ok":
                if (result.switched) {
                    this.displayConversationNotification(
                        htmlizeManageMessage(result.message),
                        "info",
                    );
                } else {
                    this.overwriteActionBubble(
                        requestId,
                        {
                            type: "html",
                            content: htmlizeManageMessage(result.message),
                            kind: "info",
                        },
                        "conversation",
                    );
                }
                return;
            case "warning":
                this.overwriteActionBubble(
                    requestId,
                    {
                        type: "html",
                        content: htmlizeManageMessage(result.message),
                        kind: "warning",
                    },
                    "conversation",
                );
                return;
            case "error":
                this.overwriteActionBubble(
                    requestId,
                    {
                        type: "html",
                        content: `❌ ${htmlizeManageMessage(result.message)}`,
                        kind: "error",
                    },
                    "conversation",
                );
                return;
            case "cancelled":
                this.overwriteActionBubble(
                    requestId,
                    {
                        type: "html",
                        content: "Cancelled.",
                        kind: "info",
                    },
                    "conversation",
                );
                return;
            case "info":
                this.overwriteActionBubble(
                    requestId,
                    {
                        type: "html",
                        content: `Current conversation: <b>${escapeHtml(result.name)}</b> (${escapeHtml(result.conversationId)})`,
                        kind: "info",
                    },
                    "conversation",
                );
                return;
            case "list": {
                let html: string;
                if (result.conversations.length === 0) {
                    html = "No conversations found.";
                } else {
                    const rows = result.conversations.map((s) => {
                        const isCurrent =
                            s.conversationId === result.currentConversationId;
                        const marker = isCurrent ? " ← <b>current</b>" : "";
                        const date = new Date(s.createdAt).toLocaleDateString();
                        return `• <b>${escapeHtml(s.name)}</b> (${escapeHtml(s.conversationId)}) — ${s.clientCount} client(s), created ${escapeHtml(date)}${marker}`;
                    });
                    html = `<b>Conversations (${result.conversations.length})</b><br>${rows.join("<br>")}`;
                }
                this.overwriteActionBubble(
                    requestId,
                    { type: "html", content: html, kind: "info" },
                    "conversation",
                );
                return;
            }
        }
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
    private static readonly REPLAY_BUFFER_MAX = 5000;
    private replayBuffer: BridgeToWebviewMessage[] | undefined;
    private replayBufferOverflowed = false;

    private broadcastToWebviews(msg: BridgeToWebviewMessage): void {
        if (
            this.replayBuffer !== undefined &&
            AgentServerBridge.REPLAY_BUFFERED_TYPES.has(msg.type)
        ) {
            if (
                this.replayBuffer.length >= AgentServerBridge.REPLAY_BUFFER_MAX
            ) {
                if (!this.replayBufferOverflowed) {
                    this.replayBufferOverflowed = true;
                    console.warn(
                        `[AgentServerBridge] replayBuffer hit cap (${AgentServerBridge.REPLAY_BUFFER_MAX}); dropping further events until replay flushes.`,
                    );
                }
                return;
            }
            this.replayBuffer.push(msg);
            return;
        }
        for (const webview of this.webviews) {
            // If this webview is mid-hydration, queue the live message
            // until history replay has been delivered (see hydrateWebview).
            const queue = this.hydratingWebviews.get(webview);
            if (queue !== undefined) {
                queue.push(msg);
                continue;
            }
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
            this.statusBarItem.text =
                "$(debug-disconnect) TypeAgent: Disconnected";
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
