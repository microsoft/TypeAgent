// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    DispatcherConnectOptions,
    ConversationNameCollisionOptions,
    CreateConversationOptions,
    ConversationInfo,
    RenameConversationOptions,
} from "@typeagent/agent-server-protocol";
import { ClientIO, Dispatcher, DispatcherOptions } from "agent-dispatcher";
import type {
    PendingInteractionRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
import {
    createSharedDispatcher,
    SharedDispatcher,
} from "./sharedDispatcher.js";
import { lockInstanceDir } from "agent-dispatcher/internal";

import registerDebug from "debug";
const debugConversation = registerDebug("agent-server:conversation");
const debugConversationErr = registerDebug("agent-server:conversation:error");

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CONVERSATIONS_DIR = "conversations";
const METADATA_FILE = "conversations.json";

type ConversationMetadata = {
    conversationId: string;
    name: string;
    createdAt: string;
};

type ConversationRecord = {
    conversationId: string;
    name: string;
    createdAt: string;
    lastActiveAt: number;
    sharedDispatcher: SharedDispatcher | undefined; // undefined = not yet restored
    sharedDispatcherP: Promise<SharedDispatcher> | undefined; // in-progress init
    idleTimer: ReturnType<typeof setTimeout> | undefined;
};

type PersistedMetadata = {
    sessions: ConversationMetadata[]; // keep JSON key for backward compat
};

export type ConversationManager = {
    createConversation(
        name: string,
        options?: CreateConversationOptions,
    ): Promise<ConversationInfo>;
    /**
     * Resolve a conversation ID. If undefined, returns the default conversation,
     * creating one if none exist.
     */
    resolveConversationId(conversationId: string | undefined): Promise<string>;
    /**
     * Pre-initialize the most recently active conversation's dispatcher so it is
     * ready before the first client connects. If no conversations exist, a "default"
     * conversation is created. Safe to call multiple times.
     */
    prewarmMostRecentConversation(): Promise<void>;
    joinConversation(
        conversationId: string,
        clientIO: ClientIO,
        closeFn: () => void,
        options?: DispatcherConnectOptions,
    ): Promise<{
        dispatcher: Dispatcher;
        connectionId: string;
        name: string;
        pendingInteractions: PendingInteractionRequest[];
        queueSnapshot?: QueueSnapshot;
    }>;
    leaveConversation(
        conversationId: string,
        connectionId: string,
    ): Promise<void>;
    listConversations(name?: string): ConversationInfo[];
    renameConversation(
        conversationId: string,
        newName: string,
        options?: RenameConversationOptions,
    ): Promise<void>;
    deleteConversation(conversationId: string): Promise<void>;
    close(): Promise<void>;
};

/** @deprecated Use ConversationManager instead */
export type SessionManager = ConversationManager;

export async function createConversationManager(
    hostName: string,
    baseOptions: DispatcherOptions,
    baseDir: string,
    idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
): Promise<ConversationManager> {
    const conversationsDir = path.join(baseDir, CONVERSATIONS_DIR);

    // TODO: deprecate and remove this on-disk migration once enough time has
    // passed that no production install still has a "server-sessions/"
    // directory hanging around.
    // Migrate old on-disk layout: "server-sessions/" → "conversations/".
    // IMPORTANT: do this BEFORE creating the destination — otherwise
    // `fs.rename` fails with EPERM/EEXIST on Windows when the target
    // already exists, silently stranding all historical conversations
    // in the old directory.
    const oldConversationsDir = path.join(baseDir, "server-sessions");
    if (
        !fs.existsSync(conversationsDir) &&
        fs.existsSync(oldConversationsDir)
    ) {
        try {
            await fs.promises.rename(oldConversationsDir, conversationsDir);
            debugConversation(
                `Migrated on-disk directory "server-sessions" → "conversations"`,
            );
        } catch (e: any) {
            debugConversationErr("Failed to migrate server-sessions dir:", e);
        }
    } else if (fs.existsSync(oldConversationsDir)) {
        // Both directories exist — earlier builds raced and pre-created
        // the destination. Move stragglers across so users don't lose history.
        try {
            for (const entry of await fs.promises.readdir(oldConversationsDir, {
                withFileTypes: true,
            })) {
                const src = path.join(oldConversationsDir, entry.name);
                const dst = path.join(conversationsDir, entry.name);
                if (fs.existsSync(dst)) continue;
                try {
                    await fs.promises.rename(src, dst);
                } catch (e: any) {
                    debugConversationErr(`Failed to migrate ${entry.name}:`, e);
                }
            }
            // Best-effort cleanup; will fail silently if non-empty.
            await fs.promises.rmdir(oldConversationsDir).catch(() => undefined);
            debugConversation(
                `Merged stragglers from "server-sessions" → "conversations"`,
            );
        } catch (e: any) {
            debugConversationErr(
                "Failed to merge server-sessions stragglers:",
                e,
            );
        }
    }
    await fs.promises.mkdir(conversationsDir, { recursive: true });
    // Migrate old metadata filename: "sessions.json" → "conversations.json"
    const oldMetadataPath = path.join(conversationsDir, "sessions.json");
    const newMetadataPath = path.join(conversationsDir, METADATA_FILE);
    try {
        await fs.promises.rename(oldMetadataPath, newMetadataPath);
        debugConversation(
            `Migrated metadata file "sessions.json" → "conversations.json"`,
        );
    } catch (e: any) {
        if (e?.code !== "ENOENT") {
            debugConversationErr("Failed to migrate sessions.json:", e);
        }
    }

    // Lock the shared instance directory for the lifetime of this process.
    // Each per-conversation dispatcher locks its own persistDir; this lock covers
    // the instanceDir (= baseDir) that backs instanceStorage across all conversations.
    const unlockInstanceDir = await lockInstanceDir(baseDir);

    const conversations = new Map<string, ConversationRecord>();

    // Single-flight lock for "auto-create the default conversation". Two
    // concurrent first-connects could both observe "no conversations exist"
    // and race; this serializes them so only one create happens.
    let defaultCreateP: Promise<string> | undefined;

    // Load persisted metadata
    await loadMetadata();

    // One-time migration: pre-rename builds stored entries with `sessionId` instead
    // of `conversationId`. On first load after the rename, both field names are
    // accepted and the file is re-written in the new format automatically.
    async function loadMetadata(): Promise<void> {
        const metadataPath = path.join(conversationsDir, METADATA_FILE);
        try {
            const data = await fs.promises.readFile(metadataPath, "utf-8");
            const persisted: PersistedMetadata = JSON.parse(data);
            let needsMigration = false;
            for (const entry of persisted.sessions) {
                // Migrate old on-disk format: `sessionId` → `conversationId`
                const conversationId =
                    entry.conversationId ?? (entry as any).sessionId;
                if (!conversationId) continue;
                if (!entry.conversationId) needsMigration = true;
                conversations.set(conversationId, {
                    conversationId,
                    name: entry.name,
                    createdAt: entry.createdAt,
                    lastActiveAt: 0,
                    sharedDispatcher: undefined, // lazy restore
                    sharedDispatcherP: undefined,
                    idleTimer: undefined,
                });
            }
            debugConversation(
                `Loaded ${conversations.size} conversation(s) from metadata`,
            );
            if (needsMigration) {
                debugConversation(
                    "Migrating metadata from old sessionId format to conversationId",
                );
                await saveMetadata();
            }
        } catch (e: any) {
            if (e?.code === "ENOENT") {
                // No metadata file yet — first run
                debugConversation(
                    "No conversation metadata found, starting fresh",
                );
            } else {
                // File exists but is unreadable or malformed — log and start fresh
                debugConversationErr(
                    "Failed to load conversation metadata, starting fresh:",
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
        const metadataPath = path.join(conversationsDir, METADATA_FILE);
        const tmpPath = `${metadataPath}.tmp`;
        const entries: ConversationMetadata[] = [];
        for (const record of conversations.values()) {
            entries.push({
                conversationId: record.conversationId,
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

    function getConversationPersistDir(conversationId: string): string {
        return path.join(conversationsDir, conversationId);
    }

    function ensureDispatcher(
        record: ConversationRecord,
    ): Promise<SharedDispatcher> {
        if (record.sharedDispatcher !== undefined) {
            return Promise.resolve(record.sharedDispatcher);
        }
        if (record.sharedDispatcherP === undefined) {
            const persistDir = getConversationPersistDir(record.conversationId);
            record.sharedDispatcherP = fs.promises
                .mkdir(persistDir, { recursive: true })
                .then(() =>
                    createSharedDispatcher(hostName, {
                        ...baseOptions,
                        persistDir,
                        instanceDir: baseDir,
                        persistSession: true,
                    }),
                )
                .then((dispatcher) => {
                    record.sharedDispatcher = dispatcher;
                    record.sharedDispatcherP = undefined;
                    debugConversation(
                        `Dispatcher initialized for conversation "${record.name}" (${record.conversationId})`,
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

    function cancelIdleTimer(record: ConversationRecord): void {
        if (record.idleTimer !== undefined) {
            clearTimeout(record.idleTimer);
            record.idleTimer = undefined;
            debugConversation(
                `Idle timer cancelled for conversation "${record.name}" (${record.conversationId})`,
            );
        }
    }

    function startIdleTimer(record: ConversationRecord): void {
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
                debugConversation(
                    `Idle timeout: closing dispatcher for conversation "${record.name}" (${record.conversationId})`,
                );
                try {
                    await record.sharedDispatcher.close();
                    record.sharedDispatcher = undefined;
                } catch (e) {
                    debugConversationErr(
                        `Failed to close idle dispatcher for conversation "${record.name}" (${record.conversationId}):`,
                        e,
                    );
                }
            }
        }, idleTimeoutMs);
    }

    function touchConversation(conversationId: string): void {
        const record = conversations.get(conversationId);
        if (record) {
            record.lastActiveAt = Date.now();
        }
    }

    function getDefaultConversationId(): string | undefined {
        for (const [id, record] of conversations) {
            if (record.name.toLowerCase() === "default") {
                return id;
            }
        }
        return undefined;
    }

    function getAnyConversationId(): string | undefined {
        for (const id of conversations.keys()) {
            return id;
        }
        return undefined;
    }

    function validateConversationName(name: string): void {
        if (name.length === 0 || name.length > 256) {
            throw new Error(
                "Conversation name must be between 1 and 256 characters",
            );
        }
    }

    /**
     * Throw if `name` collides (case-insensitive) with another existing
     * conversation. `selfId` is excluded from the check so renaming a
     * conversation to its current name is a no-op rather than an error.
     */
    function ensureNameAvailable(name: string, selfId?: string): void {
        const norm = name.trim().toLowerCase();
        for (const [id, record] of conversations) {
            if (id === selfId) continue;
            if (record.name.trim().toLowerCase() === norm) {
                throw new Error(
                    `A conversation named "${record.name}" already exists. Pick a different name.`,
                );
            }
        }
    }

    function isNameAvailable(name: string, selfId?: string): boolean {
        const norm = name.trim().toLowerCase();
        for (const [id, record] of conversations) {
            if (id === selfId) continue;
            if (record.name.trim().toLowerCase() === norm) {
                return false;
            }
        }
        return true;
    }

    function splitNumberSuffix(name: string): {
        baseName: string;
        suffix: number;
    } {
        const match = /^(.*) \((\d+)\)$/.exec(name);
        if (match === null || match[1].length === 0) {
            return { baseName: name, suffix: 0 };
        }
        return { baseName: match[1], suffix: Number(match[2]) };
    }

    function resolveAvailableName(
        name: string,
        options?: ConversationNameCollisionOptions,
        selfId?: string,
    ): string {
        const behavior = options?.nameCollisionBehavior ?? "error";
        if (behavior === "error") {
            ensureNameAvailable(name, selfId);
            return name;
        }
        if (behavior !== "appendNumber") {
            throw new Error(`Unknown name collision behavior: ${behavior}`);
        }
        if (isNameAvailable(name, selfId)) {
            return name;
        }

        const requested = splitNumberSuffix(name.trim());
        const baseNorm = requested.baseName.trim().toLowerCase();
        let maxSuffix = 0;
        for (const record of conversations.values()) {
            if (record.conversationId === selfId) continue;
            const existing = splitNumberSuffix(record.name.trim());
            if (existing.baseName.trim().toLowerCase() === baseNorm) {
                maxSuffix = Math.max(maxSuffix, existing.suffix);
            }
        }
        const resolved = `${requested.baseName} (${maxSuffix + 1})`;
        validateConversationName(resolved);
        return resolved;
    }

    // Sweep orphaned ephemeral conversations left behind by unclean CLI exits
    {
        const toSweep: string[] = [];
        for (const [id, record] of conversations) {
            if (
                record.name.startsWith("cli-ephemeral-") ||
                record.name.startsWith("cli-replay-")
            ) {
                toSweep.push(id);
            }
        }
        for (const id of toSweep) {
            const record = conversations.get(id)!;
            debugConversation(
                `Sweeping orphaned ephemeral conversation "${record.name}" (${id})`,
            );
            conversations.delete(id);
            const persistDir = getConversationPersistDir(id);
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

    const manager: ConversationManager = {
        async createConversation(
            name: string,
            options?: CreateConversationOptions,
        ): Promise<ConversationInfo> {
            validateConversationName(name);
            const resolvedName = resolveAvailableName(name, options);
            const conversationId = randomUUID();
            const createdAt = new Date().toISOString();
            const record: ConversationRecord = {
                conversationId,
                name: resolvedName,
                createdAt,
                lastActiveAt: Date.now(),
                sharedDispatcher: undefined,
                sharedDispatcherP: undefined,
                idleTimer: undefined,
            };
            conversations.set(conversationId, record);
            await saveMetadata();
            debugConversation(
                `Conversation created: "${resolvedName}" (${conversationId})`,
            );
            return {
                conversationId,
                name: resolvedName,
                clientCount: 0,
                createdAt,
            };
        },

        async resolveConversationId(
            conversationId: string | undefined,
        ): Promise<string> {
            if (conversationId !== undefined) {
                if (!conversations.has(conversationId)) {
                    throw new Error(
                        `Conversation not found: ${conversationId}`,
                    );
                }
                return conversationId;
            }
            // Prefer the conversation named "default"; fall back to any existing conversation
            const resolved =
                getDefaultConversationId() ?? getAnyConversationId();
            if (resolved !== undefined) {
                return resolved;
            }
            // No conversations exist — auto-create a default. Serialize so two
            // concurrent first-connects don't both try to create "default" and
            // race the duplicate-name check.
            if (defaultCreateP === undefined) {
                defaultCreateP = (async () => {
                    // Re-check inside the critical section in case another caller
                    // raced us between the early check above and acquiring the lock.
                    const existing =
                        getDefaultConversationId() ?? getAnyConversationId();
                    if (existing !== undefined) return existing;
                    const info = await manager.createConversation("default");
                    return info.conversationId;
                })().finally(() => {
                    defaultCreateP = undefined;
                });
            }
            return defaultCreateP;
        },

        async prewarmMostRecentConversation(): Promise<void> {
            const conversationId =
                await manager.resolveConversationId(undefined);
            const record = conversations.get(conversationId)!;
            cancelIdleTimer(record);
            await ensureDispatcher(record);
            debugConversation(
                `Pre-warmed dispatcher for conversation "${record.name}" (${conversationId})`,
            );
        },

        async joinConversation(
            conversationId: string,
            clientIO: ClientIO,
            closeFn: () => void,
            options?: DispatcherConnectOptions,
        ): Promise<{
            dispatcher: Dispatcher;
            connectionId: string;
            name: string;
            pendingInteractions: PendingInteractionRequest[];
            queueSnapshot?: QueueSnapshot;
        }> {
            const record = conversations.get(conversationId);
            if (record === undefined) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }

            cancelIdleTimer(record);
            const sharedDispatcher = await ensureDispatcher(record);
            const dispatcher = sharedDispatcher.join(
                clientIO,
                closeFn,
                options,
            );
            touchConversation(conversationId);
            await saveMetadata();

            debugConversation(
                `Client joined conversation "${record.name}" (${conversationId}), clients: ${sharedDispatcher.clientCount}`,
            );

            // Notify existing clients that a new client has joined
            if (sharedDispatcher.clientCount > 1 && dispatcher.connectionId) {
                sharedDispatcher.broadcastSystemMessage(
                    `[A new client has joined this conversation.]`,
                    dispatcher.connectionId,
                );
            }

            const queueSnapshot = sharedDispatcher.isQueueIdle()
                ? undefined
                : sharedDispatcher.getQueueSnapshot();
            const result: {
                dispatcher: Dispatcher;
                connectionId: string;
                name: string;
                pendingInteractions: PendingInteractionRequest[];
                queueSnapshot?: QueueSnapshot;
            } = {
                dispatcher,
                connectionId: dispatcher.connectionId!,
                name: record.name,
                pendingInteractions: sharedDispatcher.getPendingInteractions(
                    dispatcher.connectionId!,
                    options?.filter ?? false,
                ),
            };
            if (queueSnapshot !== undefined) {
                result.queueSnapshot = queueSnapshot;
            }
            return result;
        },

        async leaveConversation(
            conversationId: string,
            connectionId: string,
        ): Promise<void> {
            const record = conversations.get(conversationId);
            if (record === undefined) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            if (record.sharedDispatcher === undefined) {
                debugConversation(
                    `leaveConversation: dispatcher not active for conversation "${record.name}" (${conversationId}), ignoring connectionId ${connectionId}`,
                );
                return; // Conversation not active
            }

            // Notify remaining clients before this client leaves
            if (record.sharedDispatcher.clientCount > 1) {
                record.sharedDispatcher.broadcastSystemMessage(
                    `[A client has left this conversation.]`,
                    connectionId,
                );
            }

            await record.sharedDispatcher.leave(connectionId);
            debugConversation(
                `Client ${connectionId} left conversation "${record.name}" (${conversationId}), clients: ${record.sharedDispatcher.clientCount}`,
            );

            if (record.sharedDispatcher.clientCount === 0) {
                startIdleTimer(record);
            }
        },

        listConversations(name?: string): ConversationInfo[] {
            const result: ConversationInfo[] = [];
            for (const record of conversations.values()) {
                const recordName = record.name ?? "";
                if (
                    name != null &&
                    !recordName.toLowerCase().includes(name.toLowerCase())
                ) {
                    continue;
                }
                result.push({
                    conversationId: record.conversationId,
                    name: recordName,
                    clientCount: record.sharedDispatcher?.clientCount ?? 0,
                    createdAt: record.createdAt,
                });
            }
            return result;
        },

        async renameConversation(
            conversationId: string,
            newName: string,
            options?: RenameConversationOptions,
        ): Promise<void> {
            validateConversationName(newName);
            const record = conversations.get(conversationId);
            if (record === undefined) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            const resolvedName = resolveAvailableName(
                newName,
                options,
                conversationId,
            );
            record.name = resolvedName;
            await saveMetadata();
            debugConversation(
                `Conversation renamed: "${resolvedName}" (${conversationId})`,
            );
        },

        async deleteConversation(conversationId: string): Promise<void> {
            const record = conversations.get(conversationId);
            if (record === undefined) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }

            cancelIdleTimer(record);

            // Close all clients and the dispatcher
            if (record.sharedDispatcher !== undefined) {
                await record.sharedDispatcher.close();
                record.sharedDispatcher = undefined;
            }

            conversations.delete(conversationId);

            // Remove persist directory
            const persistDir = getConversationPersistDir(conversationId);
            try {
                await fs.promises.rm(persistDir, {
                    recursive: true,
                    force: true,
                });
            } catch {
                // Best effort — dir may not exist
            }

            await saveMetadata();
            debugConversation(
                `Conversation deleted: "${record.name}" (${conversationId})`,
            );
        },

        async close(): Promise<void> {
            const promises: Promise<void>[] = [];
            for (const record of conversations.values()) {
                cancelIdleTimer(record);
                if (record.sharedDispatcher !== undefined) {
                    promises.push(record.sharedDispatcher.close());
                }
            }
            await Promise.all(promises);
            await saveMetadata();
            await unlockInstanceDir();
            debugConversation("ConversationManager closed");
        },
    };

    return manager;
}

/** @deprecated Use createConversationManager instead */
export const createSessionManager = createConversationManager;
