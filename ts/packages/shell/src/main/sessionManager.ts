// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shell session manager — provides IPC handlers for session management.
 *
 * In "local" mode (in-process dispatcher), multi-session is not supported.
 * The handlers return a single "default" session and reject session switching.
 *
 * In "remote" mode (connected to agent server), the handlers delegate to the
 * AgentServerConnection's session API.
 */

import { ipcMain } from "electron";
import type {
    SessionInfo,
    SessionSwitchResult,
} from "../preload/electronTypes.js";
import type { AgentServerConnection } from "@typeagent/agent-server-client";
import type { ClientIO, Dispatcher } from "agent-dispatcher";
import { debugShell } from "./debug.js";

/**
 * Replay display history entries from a dispatcher through clientIO.
 * This sends user requests, agent displays, and interaction outcomes
 * through the same IPC pipeline that live messages use, so the renderer
 * displays them identically without needing any special handling.
 */
export async function replayDisplayHistory(
    dispatcher: Dispatcher,
    clientIO: ClientIO,
    sessionName?: string,
    markHistoryFn?: () => void,
): Promise<void> {
    const entries = await dispatcher.getDisplayHistory();
    const ts = Date.now(); // ensure unique clientRequestIds across replays

    if (entries.length === 0) {
        // Nothing to mark as history — skip markHistoryFn entirely.
        if (sessionName !== undefined) {
            clientIO.setDisplay({
                message: {
                    type: "text",
                    content: `Connected to conversation '${sessionName}'. (no history)`,
                    kind: "info",
                },
                requestId: {
                    requestId: "",
                    clientRequestId: `notification-session-info-${ts}`,
                },
                source: "session",
            });
        }
        return;
    }

    debugShell(
        `Replaying ${entries.length} history entries for session "${sessionName}"`,
    );

    // Send a "session history" separator notification
    clientIO.setDisplay({
        message: {
            type: "text",
            content: "─── session history ───",
            kind: "info",
        },
        requestId: {
            requestId: "",
            clientRequestId: `notification-session-history-start-${ts}`,
        },
        source: "session",
    });

    for (const entry of entries) {
        switch (entry.type) {
            case "user-request":
                clientIO.setUserRequest(entry.requestId, entry.command);
                break;
            case "set-display":
                clientIO.setDisplay(entry.message);
                break;
            case "append-display":
                clientIO.appendDisplay(entry.message, entry.mode);
                break;
            case "set-display-info":
                clientIO.setDisplayInfo(
                    entry.requestId,
                    entry.source,
                    entry.actionIndex,
                    entry.action,
                );
                break;
            // pending-interaction, interaction-resolved, interaction-cancelled
            // are not replayed — the Shell does not yet support deferred
            // interactions so there is no UI to display them.
            // notify entries are ephemeral — skip them.
        }
    }

    // Mark all replayed entries as history (grayscale) before adding the "now"
    // separator. All messages go through the same webContents IPC channel, so
    // this event is guaranteed to be processed before the separator below.
    markHistoryFn?.();

    // Send a "now" separator + connected notification
    clientIO.setDisplay({
        message: {
            type: "text",
            content: "─── now ───",
            kind: "info",
        },
        requestId: {
            requestId: "",
            clientRequestId: `notification-session-history-end-${ts}`,
        },
        source: "session",
    });

    if (sessionName !== undefined) {
        clientIO.setDisplay({
            message: {
                type: "text",
                content: `Connected to conversation '${sessionName}'.`,
                kind: "info",
            },
            requestId: {
                requestId: "",
                clientRequestId: `notification-session-connected-${ts}`,
            },
            source: "session",
        });
    }
}

export type SessionManagerBackend = {
    listSessions(): Promise<SessionInfo[]>;
    createSession(name: string): Promise<SessionInfo>;
    switchSession(sessionId: string): Promise<SessionSwitchResult>;
    renameSession(sessionId: string, newName: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    getCurrentSession(): Promise<
        { sessionId: string; name: string } | undefined
    >;
};

/**
 * Create a local-only session backend for in-process dispatcher mode.
 * Multi-session is not supported; all calls operate on a single default session.
 */
export function createLocalSessionBackend(): SessionManagerBackend {
    const defaultSession: SessionInfo = {
        sessionId: "local",
        name: "Default Session",
        clientCount: 1,
        createdAt: new Date().toISOString(),
    };

    return {
        async listSessions(): Promise<SessionInfo[]> {
            return [defaultSession];
        },
        async createSession(_name: string): Promise<SessionInfo> {
            throw new Error(
                "Multi-session is not supported in local mode. " +
                    "Connect to the Agent Server to use session management.",
            );
        },
        async switchSession(_sessionId: string): Promise<SessionSwitchResult> {
            return {
                success: false,
                error:
                    "Session switching is not supported in local mode. " +
                    "Connect to the Agent Server to use session management.",
            };
        },
        async renameSession(
            _sessionId: string,
            _newName: string,
        ): Promise<void> {
            throw new Error(
                "Session renaming is not supported in local mode. " +
                    "Connect to the Agent Server to use session management.",
            );
        },
        async deleteSession(_sessionId: string): Promise<void> {
            throw new Error(
                "Session deletion is not supported in local mode. " +
                    "Connect to the Agent Server to use session management.",
            );
        },
        async getCurrentSession(): Promise<
            { sessionId: string; name: string } | undefined
        > {
            return {
                sessionId: defaultSession.sessionId,
                name: defaultSession.name,
            };
        },
    };
}

/**
 * Register session management IPC handlers on ipcMain.
 * Returns a cleanup function that removes the handlers.
 */
export function registerSessionIpcHandlers(
    backend: SessionManagerBackend,
): () => void {
    const handlers = {
        "session-list": async () => {
            debugShell("IPC: session-list");
            return backend.listSessions();
        },
        "session-create": async (
            _event: Electron.IpcMainInvokeEvent,
            name: string,
        ) => {
            debugShell("IPC: session-create name=%s", name);
            return backend.createSession(name);
        },
        "session-switch": async (
            _event: Electron.IpcMainInvokeEvent,
            sessionId: string,
        ) => {
            debugShell("IPC: session-switch sessionId=%s", sessionId);
            return backend.switchSession(sessionId);
        },
        "session-rename": async (
            _event: Electron.IpcMainInvokeEvent,
            sessionId: string,
            newName: string,
        ) => {
            debugShell(
                "IPC: session-rename sessionId=%s newName=%s",
                sessionId,
                newName,
            );
            return backend.renameSession(sessionId, newName);
        },
        "session-delete": async (
            _event: Electron.IpcMainInvokeEvent,
            sessionId: string,
        ) => {
            debugShell("IPC: session-delete sessionId=%s", sessionId);
            return backend.deleteSession(sessionId);
        },
        "session-get-current": async () => {
            debugShell("IPC: session-get-current");
            return backend.getCurrentSession();
        },
    };

    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, handler);
    }

    return () => {
        for (const channel of Object.keys(handlers)) {
            ipcMain.removeHandler(channel);
        }
    };
}

/**
 * Create a remote session backend that delegates to an AgentServerConnection.
 * Uses join-before-leave when switching sessions to avoid stranded clients.
 */
export function createRemoteSessionBackend(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    initialSessionId: string,
    initialName: string,
    sendSessionChanged: (sessionId: string, name: string) => void,
    onDispatcherSwitch?: (newDispatcher: Dispatcher) => void,
    markHistoryFn?: () => void,
): SessionManagerBackend {
    let currentSessionId = initialSessionId;
    let currentName = initialName;

    return {
        async listSessions(): Promise<SessionInfo[]> {
            return connection.listSessions();
        },

        async createSession(name: string): Promise<SessionInfo> {
            return connection.createSession(name);
        },

        async switchSession(sessionId: string): Promise<SessionSwitchResult> {
            if (sessionId === currentSessionId) {
                return {
                    success: true,
                    sessionId: currentSessionId,
                    name: currentName,
                };
            }

            const oldSessionId = currentSessionId;

            // Phase 1: join new session. If this fails we haven't left the old
            // one, so fall through to the catch and report failure cleanly.
            let newSession: Awaited<ReturnType<typeof connection.joinSession>>;
            try {
                newSession = await connection.joinSession(clientIO, {
                    sessionId,
                });
            } catch (e: any) {
                debugShell(
                    "Failed to join session %s: %s",
                    sessionId,
                    e.message,
                );
                return {
                    success: false,
                    error: e.message ?? String(e),
                };
            }

            // Override close so it doesn't close the shared WebSocket
            newSession.dispatcher.close = async () => {
                await connection.leaveSession(newSession.sessionId);
            };

            // Phase 2: commit the switch. We are now joined to the new session,
            // so tracked state must be updated regardless of what happens next.
            currentSessionId = newSession.sessionId;
            currentName = newSession.name;

            // Best-effort leave of the old session — a failure here does not
            // undo the switch; the client is already on the new session.
            try {
                await connection.leaveSession(oldSessionId);
            } catch (e: any) {
                debugShell(
                    "Failed to leave old session %s (best-effort, ignoring): %s",
                    oldSessionId,
                    e.message,
                );
            }

            // Notify the shell that the dispatcher has changed so it can
            // rebind its command-processing pipeline to the new instance.
            onDispatcherSwitch?.(newSession.dispatcher);

            // Clear the renderer and replay the new session's display
            // history through clientIO (same IPC path as live messages).
            clientIO.clear({
                requestId: "",
                clientRequestId: "session-switch",
            });
            try {
                await replayDisplayHistory(
                    newSession.dispatcher,
                    clientIO,
                    newSession.name,
                    markHistoryFn,
                );
            } catch (e: any) {
                // History replay is best-effort — the switch itself succeeded.
                debugShell(
                    "Failed to replay display history for session %s: %s",
                    newSession.name,
                    e.message,
                );
            }

            sendSessionChanged(currentSessionId, currentName);

            return {
                success: true,
                sessionId: currentSessionId,
                name: currentName,
            };
        },

        async renameSession(sessionId: string, newName: string): Promise<void> {
            await connection.renameSession(sessionId, newName);
            // If the renamed session is the current one, update tracked name
            if (sessionId === currentSessionId) {
                currentName = newName;
                sendSessionChanged(currentSessionId, currentName);
            }
        },

        async deleteSession(sessionId: string): Promise<void> {
            if (sessionId === currentSessionId) {
                throw new Error(
                    "Cannot delete the currently active session. Switch to another session first.",
                );
            }
            return connection.deleteSession(sessionId);
        },

        async getCurrentSession(): Promise<
            { sessionId: string; name: string } | undefined
        > {
            return { sessionId: currentSessionId, name: currentName };
        },
    };
}
