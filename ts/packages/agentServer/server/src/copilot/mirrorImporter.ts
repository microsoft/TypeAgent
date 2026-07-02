// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ConversationManager } from "../conversationManager.js";
import {
    getDefaultSessionStorePath,
    loadChatTitles,
    openCopilotSessionStore,
    type CopilotSessionRow,
} from "./sessionStoreReader.js";
import { synthesizeDisplayLog } from "./displayLogSynthesis.js";

import registerDebug from "debug";
const debug = registerDebug("agent-server:copilot:import");
const debugError = registerDebug("agent-server:copilot:import:error");

export type ImportCopilotSessionsOptions = {
    /** Path to `session-store.db`. Defaults to the OS-standard location. */
    dbPath?: string | undefined;
    /** Case-insensitive repository substring filter. */
    repositoryFilter?: string | undefined;
    /** Only import sessions updated at/after this ISO timestamp. */
    updatedSince?: string | undefined;
    /** Include subagent surfaces (default false: top-level chat only). */
    includeSubagents?: boolean | undefined;
    /** Restrict to specific Copilot session ids (e.g. one-at-a-time import). */
    sessionIds?: string[] | undefined;
};

export type ImportedMirror = {
    conversationId: string;
    name: string;
    sessionId: string;
    /** False when a mirror for this session already existed. */
    created: boolean;
    /**
     * True when an existing mirror's name was reconciled to the current VS
     * Code title during this import.
     */
    renamed: boolean;
};

export type ImportCopilotSessionsResult = {
    /** Path of the store that was read. */
    dbPath: string;
    /** Total candidate sessions after filtering. */
    total: number;
    /** Newly created mirrors. */
    imported: number;
    /** Existing mirrors left unchanged (already imported, title unchanged). */
    skipped: number;
    /** Existing mirrors whose name was reconciled to the current VS Code title. */
    renamed: number;
    /** Sessions that errored during import. */
    failed: number;
    mirrors: ImportedMirror[];
};

/**
 * Import GitHub Copilot Chat sessions as read-only TypeAgent conversation
 * mirrors. Reads the local session store, synthesizes a display log per
 * session, and registers each as a mirror via the conversation manager.
 *
 * Idempotent: re-running only adds sessions that aren't already mirrored.
/** Progress update emitted once per session while importing. */
export type CopilotImportProgress = {
    /** 1-based index of the session currently being processed. */
    current: number;
    /** Total sessions being processed in this run. */
    total: number;
    /** Display name of the session currently being processed. */
    name: string;
};

/**
 * Import GitHub Copilot Chat sessions as read-only TypeAgent conversation
 * mirrors. Reads the local session store, synthesizes a display log per
 * session, and registers each as a mirror via the conversation manager.
 *
 * Idempotent: re-running only adds sessions that aren't already mirrored.
 * Designed so a future startup/timer hook can call it with no arguments to
 * make import automatic.
 *
 * @param onProgress optional callback invoked once per session (before it is
 *   imported) so a caller can stream progress to the user.
 */
export async function importCopilotSessions(
    conversationManager: ConversationManager,
    options: ImportCopilotSessionsOptions = {},
    onProgress?: (progress: CopilotImportProgress) => void,
): Promise<ImportCopilotSessionsResult> {
    const dbPath = options.dbPath ?? getDefaultSessionStorePath();
    const store = openCopilotSessionStore(dbPath);
    // Titles the user sees in VS Code live in the native chat files, not the
    // store; load them so mirrors are named exactly as in VS Code.
    const titles = loadChatTitles(dbPath);

    const result: ImportCopilotSessionsResult = {
        dbPath,
        total: 0,
        imported: 0,
        skipped: 0,
        renamed: 0,
        failed: 0,
        mirrors: [],
    };

    try {
        const sessions = store.listSessions({
            repositoryFilter: options.repositoryFilter,
            updatedSince: options.updatedSince,
            includeSubagents: options.includeSubagents,
            sessionIds: options.sessionIds,
        });
        result.total = sessions.length;
        debug(
            `Found ${sessions.length} candidate Copilot session(s) in ${dbPath}`,
        );

        for (let i = 0; i < sessions.length; i++) {
            const session = sessions[i];
            onProgress?.({
                current: i + 1,
                total: sessions.length,
                name: deriveMirrorName(session, titles.get(session.id)),
            });
            try {
                const turns = store.readTurns(session.id);
                if (turns.length === 0) {
                    // Nothing to display; skip empty sessions.
                    continue;
                }
                const displayLogEntries = synthesizeDisplayLog(
                    session.id,
                    turns,
                );
                const lastSyncedTurnIndex = turns[turns.length - 1].turnIndex;

                const res = await conversationManager.importCopilotMirror({
                    sessionId: session.id,
                    name: deriveMirrorName(session, titles.get(session.id)),
                    createdAt: session.createdAt,
                    displayLogEntries,
                    lastSyncedTurnIndex,
                });

                if (res.created) {
                    result.imported++;
                } else if (res.renamed) {
                    // Existing mirror whose title we reconciled — count it
                    // separately from unchanged skips.
                    result.renamed++;
                } else {
                    result.skipped++;
                }
                result.mirrors.push({
                    conversationId: res.conversationId,
                    name: res.name,
                    sessionId: session.id,
                    created: res.created,
                    renamed: res.renamed ?? false,
                });
            } catch (e) {
                result.failed++;
                debugError(
                    `Failed to import Copilot session ${session.id}: ${
                        e instanceof Error ? e.message : String(e)
                    }`,
                );
            }
        }
    } finally {
        store.close();
    }

    debug(
        `Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed of ${result.total}`,
    );
    return result;
}

/**
 * Pick a human-readable mirror name, matching what the user sees in VS Code:
 *   1. the VS Code generated chat title (`customTitle`) when available,
 *   2. else the first non-empty line of the session summary (VS Code's own
 *      fallback for untitled chats — the first user message),
 *   3. else "<branch> — <date>", else "Copilot session — <date>".
 * The conversation manager collapses whitespace, clamps length, and de-dups.
 *
 * @param title the VS Code `customTitle` for this session, if any.
 */
export function deriveMirrorName(
    session: CopilotSessionRow,
    title?: string | undefined,
): string {
    const trimmedTitle = title?.trim();
    if (trimmedTitle) {
        return trimmedTitle;
    }
    const summaryLine = session.summary
        ?.split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    if (summaryLine) {
        return summaryLine;
    }
    const date = session.createdAt?.slice(0, 10) || "unknown date";
    if (session.branch) {
        return `${session.branch} — ${date}`;
    }
    return `Copilot session — ${date}`;
}
