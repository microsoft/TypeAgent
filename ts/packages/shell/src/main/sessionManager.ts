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
import { debugShell } from "./debug.js";

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
