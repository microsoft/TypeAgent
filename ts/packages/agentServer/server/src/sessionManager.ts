// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    DispatcherConnectOptions,
    SessionInfo,
} from "@typeagent/agent-server-protocol";
import { ClientIO, Dispatcher, DispatcherOptions } from "agent-dispatcher";
import type { PendingInteractionRequest } from "@typeagent/dispatcher-types";
import {
    createSharedDispatcher,
    SharedDispatcher,
} from "./sharedDispatcher.js";
import { lockInstanceDir } from "agent-dispatcher/internal";

import registerDebug from "debug";
const debugSession = registerDebug("agent-server:session");
const debugSessionErr = registerDebug("agent-server:session:error");

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SESSIONS_DIR = "server-sessions";
const METADATA_FILE = "sessions.json";

type SessionMetadata = {
    sessionId: string;
    name: string;
    createdAt: string;
};

type SessionRecord = {
    sessionId: string;
    name: string;
    createdAt: string;
    lastActiveAt: number;
    sharedDispatcher: SharedDispatcher | undefined; // undefined = not yet restored
    sharedDispatcherP: Promise<SharedDispatcher> | undefined; // in-progress init
    idleTimer: ReturnType<typeof setTimeout> | undefined;
};

type PersistedMetadata = {
    sessions: SessionMetadata[];
};

export type SessionManager = {
    createSession(name: string): Promise<SessionInfo>;
    /**
     * Resolve a session ID. If undefined, returns the default session,
     * creating one if none exist.
     */
    resolveSessionId(sessionId: string | undefined): Promise<string>;
    /**
     * Pre-initialize the most recently active session's dispatcher so it is
     * ready before the first client connects. If no sessions exist, a "default"
     * session is created. Safe to call multiple times.
     */
    prewarmMostRecentSession(): Promise<void>;
    joinSession(
        sessionId: string,
        clientIO: ClientIO,
        closeFn: () => void,
        options?: DispatcherConnectOptions,
    ): Promise<{
        dispatcher: Dispatcher;
        connectionId: string;
        name: string;
        pendingInteractions: PendingInteractionRequest[];
    }>;
    leaveSession(sessionId: string, connectionId: string): Promise<void>;
    listSessions(name?: string): SessionInfo[];
    renameSession(sessionId: string, newName: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    close(): Promise<void>;
};

export async function createSessionManager(
    hostName: string,
    baseOptions: DispatcherOptions,
    baseDir: string,
    idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
): Promise<SessionManager> {
    const sessionsDir = path.join(baseDir, SESSIONS_DIR);
    await fs.promises.mkdir(sessionsDir, { recursive: true });

    // Lock the shared instance directory for the lifetime of this process.
    // Each per-session dispatcher locks its own persistDir; this lock covers
    // the instanceDir (= baseDir) that backs instanceStorage across all sessions.
    const unlockInstanceDir = await lockInstanceDir(baseDir);

    const sessions = new Map<string, SessionRecord>();

    // Load persisted metadata
    await loadMetadata();

    async function loadMetadata(): Promise<void> {
        const metadataPath = path.join(sessionsDir, METADATA_FILE);
        try {
            const data = await fs.promises.readFile(metadataPath, "utf-8");
            const persisted: PersistedMetadata = JSON.parse(data);
            for (const entry of persisted.sessions) {
                sessions.set(entry.sessionId, {
                    sessionId: entry.sessionId,
                    name: entry.name,
                    createdAt: entry.createdAt,
                    lastActiveAt: 0,
                    sharedDispatcher: undefined, // lazy restore
                    sharedDispatcherP: undefined,
                    idleTimer: undefined,
                });
            }
            debugSession(`Loaded ${sessions.size} session(s) from metadata`);
        } catch (e: any) {
            if (e?.code === "ENOENT") {
                // No metadata file yet — first run
                debugSession("No session metadata found, starting fresh");
            } else {
                // File exists but is unreadable or malformed — log and start fresh
                debugSessionErr(
                    "Failed to load session metadata, starting fresh:",
                    e,
                );
            }
        }
    }

    // Serialize metadata writes: each call chains onto the previous one so
    // concurrent async callers never interleave writeFile/rename operations.
    let saveQueue: Promise<void> = Promise.resolve();

    function saveMetadata(): Promise<void> {
        saveQueue = saveQueue.then(doSaveMetadata);
        return saveQueue;
    }

    async function doSaveMetadata(): Promise<void> {
        const metadataPath = path.join(sessionsDir, METADATA_FILE);
        const tmpPath = `${metadataPath}.tmp`;
        const entries: SessionMetadata[] = [];
        for (const record of sessions.values()) {
            entries.push({
                sessionId: record.sessionId,
                name: record.name,
                createdAt: record.createdAt,
            });
        }
        const persisted: PersistedMetadata = {
            sessions: entries,
        };
        await fs.promises.writeFile(
            tmpPath,
            JSON.stringify(persisted, undefined, 2),
        );
        await fs.promises.rename(tmpPath, metadataPath);
    }

    function getSessionPersistDir(sessionId: string): string {
        return path.join(sessionsDir, sessionId);
    }

    function ensureDispatcher(
        record: SessionRecord,
    ): Promise<SharedDispatcher> {
        if (record.sharedDispatcher !== undefined) {
            return Promise.resolve(record.sharedDispatcher);
        }
        if (record.sharedDispatcherP === undefined) {
            const persistDir = getSessionPersistDir(record.sessionId);
            record.sharedDispatcherP = fs.promises
                .mkdir(persistDir, { recursive: true })
                .then(() =>
                    createSharedDispatcher(hostName, {
                        ...baseOptions,
                        persistDir,
                        persistSession: true,
                    }),
                )
                .then((dispatcher) => {
                    record.sharedDispatcher = dispatcher;
                    record.sharedDispatcherP = undefined;
                    debugSession(
                        `Dispatcher initialized for session "${record.name}" (${record.sessionId})`,
                    );
                    return dispatcher;
                })
                .catch((e) => {
                    record.sharedDispatcherP = undefined;
                    throw e;
                });
        }
        return record.sharedDispatcherP;
    }

    function cancelIdleTimer(record: SessionRecord): void {
        if (record.idleTimer !== undefined) {
            clearTimeout(record.idleTimer);
            record.idleTimer = undefined;
            debugSession(
                `Idle timer cancelled for session "${record.name}" (${record.sessionId})`,
            );
        }
    }

    function startIdleTimer(record: SessionRecord): void {
        if (idleTimeoutMs <= 0) {
            return;
        }
        cancelIdleTimer(record);
        record.idleTimer = setTimeout(async () => {
            record.idleTimer = undefined;
            if (
                record.sharedDispatcher !== undefined &&
                record.sharedDispatcher.clientCount === 0
            ) {
                debugSession(
                    `Idle timeout: closing dispatcher for session "${record.name}" (${record.sessionId})`,
                );
                try {
                    await record.sharedDispatcher.close();
                    record.sharedDispatcher = undefined;
                } catch (e) {
                    debugSessionErr(
                        `Failed to close idle dispatcher for session "${record.name}" (${record.sessionId}):`,
                        e,
                    );
                }
            }
        }, idleTimeoutMs);
    }

    function touchSession(sessionId: string): void {
        const record = sessions.get(sessionId);
        if (record) {
            record.lastActiveAt = Date.now();
        }
    }

    function getDefaultSessionId(): string | undefined {
        // Case-insensitive match so "Default", "default", "DEFAULT" all work.
        // The shell uses the same case-insensitive pattern when looking up "Shell".
        for (const [id, record] of sessions) {
            if (record.name.toLowerCase() === "default") {
                return id;
            }
        }
        return undefined;
    }

    function getAnySessionId(): string | undefined {
        for (const id of sessions.keys()) {
            return id;
        }
        return undefined;
    }

    function validateSessionName(name: string): void {
        if (name.length === 0 || name.length > 256) {
            throw new Error(
                "Session name must be between 1 and 256 characters",
            );
        }
    }

    // Sweep orphaned ephemeral sessions left behind by unclean CLI exits
    {
        const toSweep: string[] = [];
        for (const [id, record] of sessions) {
            if (
                record.name.startsWith("cli-ephemeral-") ||
                record.name.startsWith("cli-replay-")
            ) {
                toSweep.push(id);
            }
        }
        for (const id of toSweep) {
            const record = sessions.get(id)!;
            debugSession(
                `Sweeping orphaned ephemeral session "${record.name}" (${id})`,
            );
            sessions.delete(id);
            const persistDir = getSessionPersistDir(id);
            try {
                await fs.promises.rm(persistDir, {
                    recursive: true,
                    force: true,
                });
            } catch {
                // Best effort — dir may not exist
            }
        }
        if (toSweep.length > 0) {
            await saveMetadata();
        }
    }

    const manager: SessionManager = {
        async createSession(name: string): Promise<SessionInfo> {
            validateSessionName(name);
            const sessionId = randomUUID();
            const createdAt = new Date().toISOString();
            const record: SessionRecord = {
                sessionId,
                name,
                createdAt,
                lastActiveAt: Date.now(),
                sharedDispatcher: undefined,
                sharedDispatcherP: undefined,
                idleTimer: undefined,
            };
            sessions.set(sessionId, record);
            await saveMetadata();
            debugSession(`Session created: "${name}" (${sessionId})`);
            return {
                sessionId,
                name,
                clientCount: 0,
                createdAt,
            };
        },

        async resolveSessionId(sessionId: string | undefined): Promise<string> {
            if (sessionId !== undefined) {
                if (!sessions.has(sessionId)) {
                    throw new Error(`Session not found: ${sessionId}`);
                }
                return sessionId;
            }
            // Prefer the session named "default"; fall back to any existing session
            const resolved = getDefaultSessionId() ?? getAnySessionId();
            if (resolved !== undefined) {
                return resolved;
            }
            // No sessions exist — auto-create a default
            const info = await manager.createSession("default");
            return info.sessionId;
        },

        async prewarmMostRecentSession(): Promise<void> {
            const sessionId = await manager.resolveSessionId(undefined);
            const record = sessions.get(sessionId)!;
            cancelIdleTimer(record);
            await ensureDispatcher(record);
            debugSession(
                `Pre-warmed dispatcher for session "${record.name}" (${sessionId})`,
            );
        },

        async joinSession(
            sessionId: string,
            clientIO: ClientIO,
            closeFn: () => void,
            options?: DispatcherConnectOptions,
        ): Promise<{
            dispatcher: Dispatcher;
            connectionId: string;
            name: string;
            pendingInteractions: PendingInteractionRequest[];
        }> {
            const record = sessions.get(sessionId);
            if (record === undefined) {
                throw new Error(`Session not found: ${sessionId}`);
            }

            cancelIdleTimer(record);
            const sharedDispatcher = await ensureDispatcher(record);
            const dispatcher = sharedDispatcher.join(
                clientIO,
                closeFn,
                options,
            );
            touchSession(sessionId);
            await saveMetadata();

            debugSession(
                `Client joined session "${record.name}" (${sessionId}), clients: ${sharedDispatcher.clientCount}`,
            );

            // Notify existing clients that a new client has joined
            if (sharedDispatcher.clientCount > 1 && dispatcher.connectionId) {
                sharedDispatcher.broadcastSystemMessage(
                    `[A new client has joined this conversation. You are connected to '${record.name}'.]`,
                    dispatcher.connectionId,
                );
            }

            return {
                dispatcher,
                connectionId: dispatcher.connectionId!,
                name: record.name,
                pendingInteractions: sharedDispatcher.getPendingInteractions(
                    dispatcher.connectionId!,
                    options?.filter ?? false,
                ),
            };
        },

        async leaveSession(
            sessionId: string,
            connectionId: string,
        ): Promise<void> {
            const record = sessions.get(sessionId);
            if (record === undefined) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            if (record.sharedDispatcher === undefined) {
                debugSession(
                    `leaveSession: dispatcher not active for session "${record.name}" (${sessionId}), ignoring connectionId ${connectionId}`,
                );
                return; // Session not active
            }

            // Notify remaining clients before this client leaves
            if (record.sharedDispatcher.clientCount > 1) {
                record.sharedDispatcher.broadcastSystemMessage(
                    `[A client has left this conversation. You remain connected to '${record.name}'.]`,
                    connectionId,
                );
            }

            await record.sharedDispatcher.leave(connectionId);
            debugSession(
                `Client ${connectionId} left session "${record.name}" (${sessionId}), clients: ${record.sharedDispatcher.clientCount}`,
            );

            if (record.sharedDispatcher.clientCount === 0) {
                startIdleTimer(record);
            }
        },

        listSessions(name?: string): SessionInfo[] {
            const result: SessionInfo[] = [];
            for (const record of sessions.values()) {
                const recordName = record.name ?? "";
                if (
                    name != null &&
                    !recordName.toLowerCase().includes(name.toLowerCase())
                ) {
                    continue;
                }
                result.push({
                    sessionId: record.sessionId,
                    name: recordName,
                    clientCount: record.sharedDispatcher?.clientCount ?? 0,
                    createdAt: record.createdAt,
                });
            }
            return result;
        },

        async renameSession(sessionId: string, newName: string): Promise<void> {
            validateSessionName(newName);
            const record = sessions.get(sessionId);
            if (record === undefined) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            record.name = newName;
            await saveMetadata();
            debugSession(`Session renamed: "${newName}" (${sessionId})`);
        },

        async deleteSession(sessionId: string): Promise<void> {
            const record = sessions.get(sessionId);
            if (record === undefined) {
                throw new Error(`Session not found: ${sessionId}`);
            }

            cancelIdleTimer(record);

            // Close all clients and the dispatcher
            if (record.sharedDispatcher !== undefined) {
                await record.sharedDispatcher.close();
                record.sharedDispatcher = undefined;
            }

            sessions.delete(sessionId);

            // Remove persist directory
            const persistDir = getSessionPersistDir(sessionId);
            try {
                await fs.promises.rm(persistDir, {
                    recursive: true,
                    force: true,
                });
            } catch {
                // Best effort — dir may not exist
            }

            await saveMetadata();
            debugSession(`Session deleted: "${record.name}" (${sessionId})`);
        },

        async close(): Promise<void> {
            const promises: Promise<void>[] = [];
            for (const record of sessions.values()) {
                cancelIdleTimer(record);
                if (record.sharedDispatcher !== undefined) {
                    promises.push(record.sharedDispatcher.close());
                }
            }
            await Promise.all(promises);
            await saveMetadata();
            await unlockInstanceDir();
            debugSession("SessionManager closed");
        },
    };

    return manager;
}
