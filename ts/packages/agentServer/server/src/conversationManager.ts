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
    ConversationMatch,
    ConversationContentMatch,
    ConversationSource,
    RenameConversationOptions,
} from "@typeagent/agent-server-protocol";
import {
    ClientIO,
    Dispatcher,
    DispatcherOptions,
    ConversationIndexTarget,
    ConversationIndexResult,
    ConversationIndexProgress,
    ConversationSummaryResult,
} from "agent-dispatcher";
import type { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import type {
    DisplayLogEntry,
    PendingInteractionRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
import {
    createSharedDispatcher,
    SharedDispatcher,
} from "./sharedDispatcher.js";
import {
    ConversationNameIndex,
    createConversationNameIndex,
} from "./conversationNameIndex.js";
import {
    ContentSearchQuery,
    createConversationSearchIndex,
    selectUnindexedTurns,
} from "./conversationSearchIndex.js";
import { importCopilotSessions } from "./copilot/mirrorImporter.js";
import {
    buildTranscriptTurns,
    createConversationSummaryTranslator,
    summarizeTranscript,
    type ConversationSummaryTranslator,
} from "./conversationSummary.js";
import { lockInstanceDir } from "agent-dispatcher/internal";

import registerDebug from "debug";
const debugConversation = registerDebug("agent-server:conversation");
const debugConversationErr = registerDebug("agent-server:conversation:error");
const debugIndex = registerDebug("agent-server:conversation:index");

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CONVERSATIONS_DIR = "conversations";
const METADATA_FILE = "conversations.json";
// Must match the filename DisplayLog.load()/save() use in the dispatcher; a
// synthesized mirror log is written here so the conversation replays normally.
const DISPLAY_LOG_FILE_NAME = "displayLog.json";

/**
 * Metadata recorded for a conversation that originated as a mirror of a
 * GitHub Copilot Chat session. Present only on imported conversations; native
 * TypeAgent conversations leave this undefined.
 */
export type CopilotMirrorMetadata = {
    /** The Copilot `sessions.id` this mirror was imported from. */
    sessionId: string;
    /**
     * Highest Copilot `turn_index` that has been imported so far. Used as the
     * incremental-sync watermark; turns with a greater index are new.
     */
    lastSyncedTurnIndex: number;
    /** ISO timestamp of the last successful import/sync. */
    lastSyncedAt: string;
};

/** Parameters for {@link ConversationManager.importCopilotMirror}. */
export type ImportCopilotMirrorParams = {
    /** Copilot `sessions.id`; the idempotency key for the mirror. */
    sessionId: string;
    /** Desired display name (e.g. session summary). Clamped to 256 chars. */
    name: string;
    /** ISO creation time to record (e.g. the Copilot session's created_at). */
    createdAt: string;
    /** Pre-synthesized display log entries to persist for replay. */
    displayLogEntries: DisplayLogEntry[];
    /** Highest Copilot turn_index represented in {@link displayLogEntries}. */
    lastSyncedTurnIndex: number;
};

/** Result of {@link ConversationManager.importCopilotMirror}. */
export type ImportCopilotMirrorResult = {
    conversationId: string;
    name: string;
    /** False when a mirror for this session already existed (no-op). */
    created: boolean;
    /**
     * True when an existing mirror's display name was reconciled to the
     * current VS Code title during this import. Only meaningful when
     * `created` is false.
     */
    renamed?: boolean;
};

/**
 * Normalize a raw mirror name (e.g. a VS Code chat title or session summary):
 * collapse whitespace and clamp length, leaving room for an appended " (N)"
 * de-dup suffix. Falls back to a generic label when empty.
 */
function normalizeMirrorName(rawName: string): string {
    return (
        rawName.trim().replace(/\s+/g, " ").slice(0, 200) || "Copilot session"
    );
}

type ConversationMetadata = {
    conversationId: string;
    name: string;
    createdAt: string;
    source?: ConversationSource;
    readOnly?: boolean;
    copilot?: CopilotMirrorMetadata;
};

type ConversationRecord = {
    conversationId: string;
    name: string;
    createdAt: string;
    lastActiveAt: number;
    sharedDispatcher: SharedDispatcher | undefined; // undefined = not yet restored
    sharedDispatcherP: Promise<SharedDispatcher> | undefined; // in-progress init
    idleTimer: ReturnType<typeof setTimeout> | undefined;
    source?: ConversationSource | undefined;
    readOnly?: boolean | undefined;
    copilot?: CopilotMirrorMetadata | undefined;
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
    listConversations(name?: string): Promise<ConversationInfo[]>;
    /**
     * Fuzzy-find conversations by name, blending lexical and embedding
     * similarity. Sorted by descending relevance score.
     */
    findConversations(
        query: string,
        maxMatches?: number,
    ): Promise<ConversationMatch[]>;
    /**
     * Index a conversation message into the unified content-search index
     * (tagged by conversation id). Populated by callers as turns arrive.
     * `turnKey` (the source turn's id) is recorded on user messages so the
     * turn is counted once and skipped by a later history backfill.
     */
    indexConversationMessage(
        conversationId: string,
        text: string,
        sender?: string,
        turnKey?: string,
    ): void;
    /**
     * Cross-conversation content search: rank conversations by how well their
     * indexed messages match the query. Accepts a natural-language `question`,
     * keyword `terms`, or both (blended). Returns [] when the unified index has
     * no model provider configured.
     */
    searchConversationContent(
        query: ContentSearchQuery,
        maxMatches?: number,
    ): Promise<ConversationContentMatch[]>;
    /**
     * Backfill conversation history into the unified content index. For each
     * targeted conversation, indexes the user turns not already present (live
     * or from an earlier backfill) and reports how many were newly indexed.
     * `currentConversationId` resolves the `current` target. `onProgress`, if
     * given, is called as turns are indexed (for a live progress display).
     */
    indexConversations(
        target: ConversationIndexTarget,
        currentConversationId: string,
        onProgress?: (progress: ConversationIndexProgress) => void,
    ): Promise<ConversationIndexResult>;
    renameConversation(
        conversationId: string,
        newName: string,
        options?: RenameConversationOptions,
    ): Promise<void>;
    deleteConversation(conversationId: string): Promise<void>;
    /**
     * Create a read-only mirror of a GitHub Copilot Chat session. Idempotent on
     * `sessionId`: if a mirror for that session already exists this is a no-op
     * and returns the existing conversation with `created: false`. (Incremental
     * sync of new turns into an existing mirror is a later phase.)
     */
    importCopilotMirror(
        params: ImportCopilotMirrorParams,
    ): Promise<ImportCopilotMirrorResult>;
    /**
     * Install a client-hosted agent (typically an agent-rpc proxy) as a dynamic
     * agent on a conversation's dispatcher. The conversation must already have a
     * dispatcher (i.e. a client has joined). Rejects if `name` already exists.
     */
    addClientAgent(
        conversationId: string,
        name: string,
        manifest: AppAgentManifest,
        appAgent: AppAgent,
    ): Promise<void>;
    /** Remove a client-hosted agent added via {@link addClientAgent}. */
    removeClientAgent(conversationId: string, name: string): Promise<void>;
    close(): Promise<void>;
};

/** @deprecated Use ConversationManager instead */
export type SessionManager = ConversationManager;

export async function createConversationManager(
    hostName: string,
    baseOptions: DispatcherOptions,
    baseDir: string,
    idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
    // When true (embedded test hosts), skip work that would make real model
    // calls - currently the on-demand conversation summary model.
    testMode: boolean = false,
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

    // Fuzzy index over conversation names (lexical + embedding), backing
    // `findConversations`. Kept in sync as conversations are created, renamed,
    // and deleted.
    const conversationNameIndex: ConversationNameIndex =
        createConversationNameIndex();

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
                    source: entry.source,
                    readOnly: entry.readOnly,
                    copilot: entry.copilot,
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
            const entry: ConversationMetadata = {
                conversationId: record.conversationId,
                name: record.name,
                createdAt: record.createdAt,
            };
            // Only persist mirror fields when set, so native conversations keep
            // their existing on-disk shape.
            if (record.source !== undefined) entry.source = record.source;
            if (record.readOnly !== undefined) entry.readOnly = record.readOnly;
            if (record.copilot !== undefined) entry.copilot = record.copilot;
            entries.push(entry);
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

    // Read a conversation's persisted display-log entries, or [] when the log
    // is missing or unreadable. Shared by the user-message count and the
    // content-index backfill so both see the same on-disk history.
    async function readDisplayLogEntries(
        conversationId: string,
    ): Promise<DisplayLogEntry[]> {
        const filePath = path.join(
            getConversationPersistDir(conversationId),
            DISPLAY_LOG_FILE_NAME,
        );
        try {
            const data = await fs.promises.readFile(filePath, "utf-8");
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? (parsed as DisplayLogEntry[]) : [];
        } catch {
            return [];
        }
    }

    // Count the user requests recorded in a conversation's persisted display
    // log. Reads from disk so idle conversations (no live dispatcher) report a
    // count too; the log is flushed after each turn, so this trails by at most
    // the in-flight request. Returns 0 when the log is missing or unreadable.
    async function countUserMessages(conversationId: string): Promise<number> {
        const entries = await readDisplayLogEntries(conversationId);
        let count = 0;
        for (const entry of entries) {
            if (entry?.type === "user-request") {
                count++;
            }
        }
        return count;
    }

    // Lazily created TypeChat translator for conversation summaries. `null`
    // records a failed init (e.g. no model provider) so we don't retry it on
    // every call. Skipped in test mode so unit tests never issue a model call.
    let summaryTranslator: ConversationSummaryTranslator | null | undefined;
    function getSummaryTranslator(): ConversationSummaryTranslator | undefined {
        if (testMode) {
            return undefined;
        }
        if (summaryTranslator === undefined) {
            summaryTranslator = createConversationSummaryTranslator() ?? null;
        }
        return summaryTranslator ?? undefined;
    }

    // Resolve a conversation (exact name, then fuzzy name match, or the current
    // one when no name is given), read its stored transcript, and summarize it.
    async function summarizeConversationImpl(
        nameOrTopic: string | undefined,
        currentConversationId: string,
    ): Promise<ConversationSummaryResult> {
        const query = nameOrTopic?.trim();
        let record: ConversationRecord | undefined;
        if (query === undefined || query.length === 0) {
            record = conversations.get(currentConversationId);
        } else {
            record = findConversationByName(query);
            if (record === undefined) {
                // Fall back to a fuzzy name match (lexical + embedding).
                const matches = await conversationNameIndex.search(query, 1);
                const top = matches[0];
                if (top !== undefined) {
                    record = conversations.get(top.conversationId);
                }
            }
        }
        if (record === undefined) {
            return { kind: "not-found", query: query ?? "" };
        }
        const translator = getSummaryTranslator();
        if (translator === undefined) {
            return {
                kind: "unavailable",
                reason: "No language model is configured for summarization.",
            };
        }
        // Prefer the live dispatcher's in-memory log when the conversation is
        // active. Re-reading the on-disk log races the debounced write: the
        // summarize request itself just appended a turn, so a large log may be
        // mid-rewrite and the read sees truncated JSON or a locked file (yielding
        // zero turns). Idle conversations have no live log and fall back to disk.
        const entries =
            record.sharedDispatcher?.getDisplayLogEntries() ??
            (await readDisplayLogEntries(record.conversationId));
        const turns = buildTranscriptTurns(entries);
        if (turns.length === 0) {
            return {
                kind: "empty",
                conversationId: record.conversationId,
                name: record.name,
            };
        }
        const summary = await summarizeTranscript(
            translator,
            record.name,
            turns,
        );
        return {
            kind: "ok",
            conversationId: record.conversationId,
            name: record.name,
            summary,
        };
    }

    // Resolve a conversation by exact (case-insensitive) name, or undefined.
    function findConversationByName(
        name: string,
    ): ConversationRecord | undefined {
        const lower = name.toLowerCase();
        for (const record of conversations.values()) {
            if ((record.name ?? "").toLowerCase() === lower) {
                return record;
            }
        }
        return undefined;
    }

    function getConversationPersistDir(conversationId: string): string {
        return path.join(conversationsDir, conversationId);
    }

    // Build the wire-facing ConversationInfo for a record. Shared by
    // listConversations and findConversations so the shape stays consistent.
    async function toConversationInfo(
        record: ConversationRecord,
    ): Promise<ConversationInfo> {
        return {
            conversationId: record.conversationId,
            name: record.name ?? "",
            clientCount: record.sharedDispatcher?.clientCount ?? 0,
            createdAt: record.createdAt,
            messageCount: await countUserMessages(record.conversationId),
            indexedMessageCount: conversationSearchIndex.getIndexedTurns(
                record.conversationId,
            ).size,
            ...(record.source !== undefined ? { source: record.source } : {}),
            ...(record.readOnly !== undefined
                ? { readOnly: record.readOnly }
                : {}),
        };
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
                        // Let the per-conversation dispatcher offer name
                        // completions for `@conversation switch/rename/delete`
                        // by exposing the current set of sibling conversations.
                        getConversationList: () =>
                            [...conversations.values()].map((r) => ({
                                conversationId: r.conversationId,
                                name: r.name,
                            })),
                        // Let the `@copilot import` command import Copilot
                        // sessions server-side and stream per-session progress
                        // to the user via clientIO (works in every client).
                        copilotImport: (onProgress) =>
                            importCopilotSessions(manager, {}, onProgress).then(
                                (r) => ({
                                    total: r.total,
                                    imported: r.imported,
                                    skipped: r.skipped,
                                    renamed: r.renamed,
                                    failed: r.failed,
                                }),
                            ),
                        // Tee this conversation's live turns into the unified
                        // content index, tagged by its id, so cross-
                        // conversation search can find it. Independent of the
                        // per-conversation memory (which connected mode leaves
                        // unextracted).
                        conversationContentSink: (text, sender, turnKey) =>
                            manager.indexConversationMessage(
                                record.conversationId,
                                text,
                                sender,
                                turnKey,
                            ),
                        // Let the reasoning agent search across ALL
                        // conversations' content (the knowPro unified index)
                        // and read the best matches back, enriched with each
                        // conversation's name.
                        searchConversations: async (query, maxMatches) => {
                            const matches =
                                await manager.searchConversationContent(
                                    query,
                                    maxMatches,
                                );
                            return matches.map((m) => ({
                                conversationId: m.conversation.conversationId,
                                name: m.conversation.name,
                                score: m.score,
                                snippets: m.snippets,
                            }));
                        },
                        // Let `@conversation index` backfill a conversation's
                        // (or every conversation's) history into the unified
                        // content index. `current` resolves to this record.
                        indexConversations: (target, onProgress) =>
                            manager.indexConversations(
                                target,
                                record.conversationId,
                                onProgress,
                            ),
                        // Summarize a conversation (by name/topic, or the
                        // current one when omitted) from its stored transcript.
                        summarizeConversation: (nameOrTopic) =>
                            summarizeConversationImpl(
                                nameOrTopic,
                                record.conversationId,
                            ),
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

    function findMirrorBySessionId(
        sessionId: string,
    ): ConversationRecord | undefined {
        for (const record of conversations.values()) {
            if (record.copilot?.sessionId === sessionId) {
                return record;
            }
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

    // Seed the fuzzy name index from the loaded registry (after the ephemeral
    // sweep above). Names make lexical matching work immediately; embeddings
    // are generated in the background so startup (and bulk imports) never block
    // on embedding calls.
    for (const record of conversations.values()) {
        conversationNameIndex.update(record.conversationId, record.name);
    }
    void conversationNameIndex.prime();

    // Unified content-search index across all conversations, tagged by
    // conversation id. Inert when no model provider is configured.
    const conversationSearchIndex = await createConversationSearchIndex(
        path.join(conversationsDir, "_unified"),
    );

    // Re-apply deletes from previous runs. The unified index persists messages
    // (append-only) but its tombstone set is in-memory, so any indexed
    // conversation that no longer exists in the live registry must be
    // tombstoned again now, or its content would resurface in search.
    const staleTombstoned = conversationSearchIndex.reconcileTombstones(
        new Set(conversations.keys()),
    );
    if (staleTombstoned > 0) {
        debugConversation(
            `Unified index: tombstoned ${staleTombstoned} deleted conversation(s) on startup`,
        );
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
            conversationNameIndex.update(conversationId, resolvedName);
            await saveMetadata();
            debugConversation(
                `Conversation created: "${resolvedName}" (${conversationId})`,
            );
            return {
                conversationId,
                name: resolvedName,
                clientCount: 0,
                createdAt,
                messageCount: 0,
            };
        },

        async importCopilotMirror(
            params: ImportCopilotMirrorParams,
        ): Promise<ImportCopilotMirrorResult> {
            const existing = findMirrorBySessionId(params.sessionId);
            if (existing !== undefined) {
                // Content is idempotent, but reconcile the display name so a
                // re-import adopts a title VS Code generated or changed after
                // the mirror was first created (early imports fall back to the
                // first user message until Copilot titles the chat).
                // Appending newly-arrived turns is a later sync phase.
                const desiredName = resolveAvailableName(
                    normalizeMirrorName(params.name),
                    { nameCollisionBehavior: "appendNumber" },
                    existing.conversationId,
                );
                let renamed = false;
                if (desiredName !== existing.name) {
                    debugConversation(
                        `Reconciling Copilot mirror name "${existing.name}" -> "${desiredName}" (${existing.conversationId})`,
                    );
                    existing.name = desiredName;
                    conversationNameIndex.update(
                        existing.conversationId,
                        desiredName,
                    );
                    await saveMetadata();
                    renamed = true;
                }
                return {
                    conversationId: existing.conversationId,
                    name: existing.name,
                    created: false,
                    renamed,
                };
            }

            const resolvedName = resolveAvailableName(
                normalizeMirrorName(params.name),
                {
                    nameCollisionBehavior: "appendNumber",
                },
            );

            const conversationId = randomUUID();
            const record: ConversationRecord = {
                conversationId,
                name: resolvedName,
                createdAt: params.createdAt,
                lastActiveAt: 0,
                sharedDispatcher: undefined,
                sharedDispatcherP: undefined,
                idleTimer: undefined,
                source: "copilot",
                readOnly: true,
                copilot: {
                    sessionId: params.sessionId,
                    lastSyncedTurnIndex: params.lastSyncedTurnIndex,
                    lastSyncedAt: new Date().toISOString(),
                },
            };
            conversations.set(conversationId, record);
            conversationNameIndex.update(conversationId, resolvedName);

            // Persist the synthesized display log so joining the conversation
            // replays the imported history through the normal replay path.
            const persistDir = getConversationPersistDir(conversationId);
            await fs.promises.mkdir(persistDir, { recursive: true });
            const logPath = path.join(persistDir, DISPLAY_LOG_FILE_NAME);
            const tmpPath = `${logPath}.tmp`;
            await fs.promises.writeFile(
                tmpPath,
                JSON.stringify(params.displayLogEntries),
            );
            await fs.promises.rename(tmpPath, logPath);

            await saveMetadata();
            debugConversation(
                `Imported Copilot mirror "${resolvedName}" (${conversationId}) from session ${params.sessionId} with ${params.displayLogEntries.length} display entries`,
            );
            return { conversationId, name: resolvedName, created: true };
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
            const sharedDispatcher = await ensureDispatcher(record);
            debugConversation(
                `Pre-warmed dispatcher for conversation "${record.name}" (${conversationId})`,
            );
            // Now that the conversation has finished reloading, kick off the
            // reasoning engine prewarm in the background. Doing this here (rather
            // than inside dispatcher init) keeps the reasoning module load + CLI
            // spawn off the conversation-reload critical path, so the initial
            // load stays fast.
            sharedDispatcher.prewarmReasoning();
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

        async addClientAgent(
            conversationId: string,
            name: string,
            manifest: AppAgentManifest,
            appAgent: AppAgent,
        ): Promise<void> {
            const record = conversations.get(conversationId);
            if (record === undefined) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            const sharedDispatcher = await ensureDispatcher(record);
            await sharedDispatcher.addDynamicAgent(name, manifest, appAgent);
            debugConversation(
                `Registered client agent "${name}" on conversation "${record.name}" (${conversationId})`,
            );
        },

        async removeClientAgent(
            conversationId: string,
            name: string,
        ): Promise<void> {
            const record = conversations.get(conversationId);
            // If the conversation or its dispatcher is already gone, there is
            // nothing to remove.
            if (record?.sharedDispatcher === undefined) {
                return;
            }
            await record.sharedDispatcher.removeDynamicAgent(name);
            debugConversation(
                `Removed client agent "${name}" from conversation "${record.name}" (${conversationId})`,
            );
        },

        async listConversations(name?: string): Promise<ConversationInfo[]> {
            const result: ConversationInfo[] = [];
            for (const record of conversations.values()) {
                const recordName = record.name ?? "";
                if (
                    name != null &&
                    !recordName.toLowerCase().includes(name.toLowerCase())
                ) {
                    continue;
                }
                result.push(await toConversationInfo(record));
            }
            return result;
        },

        async findConversations(
            query: string,
            maxMatches?: number,
        ): Promise<ConversationMatch[]> {
            // Coalesce with `??` rather than a `= 10` default: the RPC boundary
            // serializes an omitted `maxMatches` to `null`, which slips past a
            // default parameter and would reach the ranker as 0.
            const matches = await conversationNameIndex.search(
                query,
                maxMatches ?? 10,
            );
            const result: ConversationMatch[] = [];
            for (const match of matches) {
                const record = conversations.get(match.conversationId);
                // The index can briefly lag a concurrent delete; skip ids that
                // no longer resolve to a live conversation.
                if (record === undefined) {
                    continue;
                }
                result.push({
                    conversation: await toConversationInfo(record),
                    score: match.score,
                });
            }
            return result;
        },

        indexConversationMessage(
            conversationId: string,
            text: string,
            sender?: string,
            turnKey?: string,
        ): void {
            conversationSearchIndex.addMessage(
                conversationId,
                text,
                sender,
                turnKey,
            );
        },

        async searchConversationContent(
            query: ContentSearchQuery,
            maxMatches?: number,
        ): Promise<ConversationContentMatch[]> {
            // See findConversations: RPC serializes an omitted arg to `null`.
            const matches = await conversationSearchIndex.search(
                query,
                maxMatches ?? 10,
            );
            const result: ConversationContentMatch[] = [];
            for (const match of matches) {
                const record = conversations.get(match.conversationId);
                // The index can briefly lag a concurrent delete; skip ids
                // that no longer resolve to a live conversation.
                if (record === undefined) {
                    continue;
                }
                result.push({
                    conversation: await toConversationInfo(record),
                    score: match.score,
                    snippets: match.snippets,
                });
            }
            return result;
        },

        async indexConversations(
            target: ConversationIndexTarget,
            currentConversationId: string,
            onProgress?: (progress: ConversationIndexProgress) => void,
        ): Promise<ConversationIndexResult> {
            let ids: string[];
            if (target.scope === "all") {
                ids = [...conversations.keys()];
            } else if (target.scope === "named") {
                const match = findConversationByName(target.name);
                if (match === undefined) {
                    return { indexed: [], notFound: target.name };
                }
                ids = [match.conversationId];
            } else {
                ids = [currentConversationId];
            }
            debugIndex(
                "indexConversations scope=%s targeting %d conversation(s)",
                target.scope,
                ids.length,
            );
            // Plan first: select each conversation's un-indexed turns up front,
            // so the total is known for progress reporting before any indexing
            // begins.
            const plan: {
                id: string;
                name: string;
                turns: { text: string; turnKey: string }[];
            }[] = [];
            for (const id of ids) {
                const record = conversations.get(id);
                if (record === undefined) {
                    continue;
                }
                const alreadyIndexed =
                    conversationSearchIndex.getIndexedTurns(id);
                const entries = await readDisplayLogEntries(id);
                const turns = selectUnindexedTurns(entries, (turnKey) =>
                    alreadyIndexed.has(turnKey),
                );
                debugIndex(
                    "plan %s (%s): %d log entries, %d already indexed, %d to index",
                    id,
                    record.name ?? "",
                    entries.length,
                    alreadyIndexed.size,
                    turns.length,
                );
                plan.push({ id, name: record.name ?? "", turns });
            }
            const total = plan.reduce((n, p) => n + p.turns.length, 0);
            debugIndex(
                "total %d turns to index across %d conversation(s)",
                total,
                plan.length,
            );
            let done = 0;
            onProgress?.({ done, total, name: plan[0]?.name ?? "" });
            const indexed: ConversationIndexResult["indexed"] = [];
            for (const { id, name, turns } of plan) {
                for (const { text, turnKey } of turns) {
                    conversationSearchIndex.addMessage(
                        id,
                        text,
                        "user",
                        turnKey,
                        () => {
                            done++;
                            debugIndex("indexed %d/%d (%s)", done, total, name);
                            onProgress?.({ done, total, name });
                        },
                    );
                }
                indexed.push({
                    name,
                    newlyIndexed: turns.length,
                    totalMessages: await countUserMessages(id),
                });
            }
            // addMessage only queues; drain so the command reports completion
            // once the turns are actually indexed and written to disk, not
            // merely enqueued.
            debugIndex(
                "queued %d turns; waiting for pending index tasks",
                total,
            );
            await conversationSearchIndex.waitForPendingTasks();
            debugIndex("indexConversations done: %o", indexed);
            return { indexed };
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
            conversationNameIndex.update(conversationId, resolvedName);
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
            conversationNameIndex.remove(conversationId);
            conversationSearchIndex.tombstone(conversationId);

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
            await conversationSearchIndex.close();
            await unlockInstanceDir();
            debugConversation("ConversationManager closed");
        },
    };

    return manager;
}

/** @deprecated Use createConversationManager instead */
export const createSessionManager = createConversationManager;
