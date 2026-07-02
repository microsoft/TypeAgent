// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

import registerDebug from "debug";
const debug = registerDebug("agent-server:copilot:reader");
const debugError = registerDebug("agent-server:copilot:reader:error");

/**
 * Resolve the correct `better-sqlite3` native binary for the current runtime.
 *
 * The prebuilt `better_sqlite3.node` in `build/Release` is ABI-specific: a
 * binary built for Node.js can't load under Electron and vice versa. The repo
 * keeps ABI-specific copies alongside the package (mirroring the convention in
 * `memory-storage`): `prebuild-node/` for Node processes (the separate
 * agent-server, CLI, tests) and `prebuild-electron/` for the in-process
 * Electron shell. We point better-sqlite3 at the matching one so it loads in
 * either host.
 *
 * Falls back to `undefined` (the default `build/Release` binary) when the
 * matching prebuild dir is absent — correct for the packaged Electron app,
 * where electron-builder rebuilds `build/Release` for Electron directly.
 */
function resolveNativeBinding(): string | undefined {
    try {
        const require = createRequire(import.meta.url);
        const packageJsonPath = require.resolve("better-sqlite3/package.json");
        const isElectron = process?.versions?.electron !== undefined;
        const prebuildDir = isElectron ? "prebuild-electron" : "prebuild-node";
        const nativeBinding = path.join(
            packageJsonPath,
            "..",
            prebuildDir,
            "better_sqlite3.node",
        );
        return fs.existsSync(nativeBinding) ? nativeBinding : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Read-only access to GitHub Copilot Chat's local session store
 * (`session-store.db`, a SQLite database owned by the Copilot Chat
 * extension). We never write to it.
 *
 * The schema is an implementation detail of the Copilot extension and is
 * therefore treated defensively: we read the `schema_version` row, tolerate
 * unknown future versions, and surface a clear error if a required column is
 * missing rather than letting a raw SQLite error escape.
 *
 * Verified against `schema_version = 3`:
 *   sessions(id TEXT PK, cwd, repository, host_type, branch, summary,
 *            agent_name, agent_description, created_at, updated_at)
 *   turns(id INTEGER PK, session_id FK, turn_index INTEGER,
 *         user_message, assistant_response, timestamp,
 *         UNIQUE(session_id, turn_index))
 */

/** The `agent_name` value used by the top-level interactive chat surface. */
export const COPILOT_CHAT_AGENT_NAME = "GitHub Copilot Chat";

/** Highest `schema_version` this reader has been verified against. */
export const MAX_VERIFIED_SCHEMA_VERSION = 3;

export type CopilotSessionRow = {
    id: string;
    summary: string | null;
    repository: string | null;
    branch: string | null;
    cwd: string | null;
    hostType: string | null;
    agentName: string | null;
    createdAt: string;
    updatedAt: string;
    /** Number of turns in the session (top-level chat turns). */
    turnCount: number;
};

export type CopilotTurnRow = {
    sessionId: string;
    turnIndex: number;
    userMessage: string | null;
    assistantResponse: string | null;
    timestamp: string;
};

export type ListSessionsOptions = {
    /**
     * Case-insensitive substring matched against `repository`. When set, only
     * sessions whose repository contains this value are returned. Sessions with
     * a NULL repository are excluded when a filter is supplied.
     */
    repositoryFilter?: string | undefined;
    /** Only include sessions updated at/after this ISO timestamp. */
    updatedSince?: string | undefined;
    /**
     * Include sessions from subagent surfaces (e.g. `panel/editAgent`). By
     * default only top-level {@link COPILOT_CHAT_AGENT_NAME} sessions are
     * returned, since subagent rows are not standalone conversations.
     */
    includeSubagents?: boolean | undefined;
    /**
     * Restrict results to these Copilot `sessions.id` values. Used to import a
     * specific subset (e.g. one session at a time for per-session progress).
     */
    sessionIds?: string[] | undefined;
};

/**
 * Resolve the default path to Copilot Chat's `session-store.db` for the
 * current OS and VS Code flavor. Returns the first existing candidate, or the
 * stable-channel path if none exist yet (so callers get a sensible value to
 * report as "not found").
 */
export function getDefaultSessionStorePath(): string {
    const candidates = getSessionStorePathCandidates();
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return candidates[0];
}

/**
 * Candidate `session-store.db` locations, ordered stable channel first then
 * Insiders, for the current platform.
 */
export function getSessionStorePathCandidates(): string[] {
    const home = os.homedir();
    const flavors = ["Code", "Code - Insiders"];

    const userDirForFlavor = (flavor: string): string | undefined => {
        switch (process.platform) {
            case "win32": {
                const appData =
                    process.env.APPDATA ??
                    path.join(home, "AppData", "Roaming");
                return path.join(appData, flavor, "User");
            }
            case "darwin":
                return path.join(
                    home,
                    "Library",
                    "Application Support",
                    flavor,
                    "User",
                );
            default:
                // Linux and others follow the XDG-style ~/.config layout.
                return path.join(
                    process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
                    flavor,
                    "User",
                );
        }
    };

    const candidates: string[] = [];
    for (const flavor of flavors) {
        const userDir = userDirForFlavor(flavor);
        if (userDir) {
            candidates.push(
                path.join(
                    userDir,
                    "globalStorage",
                    "github.copilot-chat",
                    "session-store.db",
                ),
            );
        }
    }
    return candidates;
}

/**
 * Load the map of Copilot `sessionId` → generated chat title (`customTitle`)
 * from VS Code's native chat storage.
 *
 * The `session-store.db` has no title column — its `summary` is just the first
 * user message. The human-readable title VS Code shows in its chat list lives
 * instead in the per-session chat file
 * `<User>/workspaceStorage/<hash>/chatSessions/<sessionId>.jsonl`, whose
 * filename matches the store's `sessions.id`. We read the `customTitle` from
 * each so imported mirrors can be named exactly as the user sees them.
 *
 * The chat file is (despite the extension) a single JSON object whose header
 * carries `customTitle` before the bulky `requests` array, so we read only a
 * bounded prefix and extract it with a JSON-string-aware regex rather than
 * parsing multi-megabyte bodies.
 *
 * Best-effort: unreadable or title-less files are skipped. Sessions without a
 * persisted `customTitle` are simply absent from the map (callers fall back to
 * the store summary — which is what VS Code itself shows for those).
 *
 * @param dbPath path to `session-store.db`; the VS Code `User` dir (and thus
 *   `workspaceStorage`) is derived from it so the titles come from the same
 *   VS Code flavor as the store.
 */
export function loadChatTitles(
    dbPath: string = getDefaultSessionStorePath(),
): Map<string, string> {
    const titles = new Map<string, string>();
    // <User>/globalStorage/github.copilot-chat/session-store.db → <User>
    const userDir = path.dirname(path.dirname(path.dirname(dbPath)));
    const workspaceStorage = path.join(userDir, "workspaceStorage");
    if (!fs.existsSync(workspaceStorage)) {
        return titles;
    }

    let workspaceDirs: string[];
    try {
        workspaceDirs = fs.readdirSync(workspaceStorage);
    } catch (e) {
        debugError(`Failed to read workspaceStorage: ${e}`);
        return titles;
    }

    for (const workspaceDir of workspaceDirs) {
        const chatSessionsDir = path.join(
            workspaceStorage,
            workspaceDir,
            "chatSessions",
        );
        let files: string[];
        try {
            if (!fs.existsSync(chatSessionsDir)) {
                continue;
            }
            files = fs.readdirSync(chatSessionsDir);
        } catch {
            continue;
        }
        for (const file of files) {
            if (!file.endsWith(".jsonl")) {
                continue;
            }
            const sessionId = file.slice(0, -".jsonl".length);
            const title = readCustomTitle(path.join(chatSessionsDir, file));
            if (title) {
                titles.set(sessionId, title);
            }
        }
    }
    return titles;
}

/**
 * Extract a non-empty `customTitle` from the header of a chat `.jsonl` file,
 * reading only a bounded prefix (the title precedes the large `requests`
 * array). Returns undefined when absent, empty, or unreadable.
 */
function readCustomTitle(filePath: string): string | undefined {
    // 64 KiB comfortably covers the header where customTitle lives.
    const maxHeaderBytes = 64 * 1024;
    let head: string;
    try {
        const fd = fs.openSync(filePath, "r");
        try {
            const buffer = Buffer.alloc(maxHeaderBytes);
            const bytesRead = fs.readSync(fd, buffer, 0, maxHeaderBytes, 0);
            head = buffer.toString("utf8", 0, bytesRead);
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return undefined;
    }
    // Match the JSON-quoted string value (handling escapes) and unescape it.
    const match = /"customTitle"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(head);
    if (!match) {
        return undefined;
    }
    try {
        const title = (JSON.parse(match[1]) as string).trim();
        return title.length > 0 ? title : undefined;
    } catch {
        return undefined;
    }
}

export type CopilotSessionStore = {
    readonly schemaVersion: number | undefined;
    listSessions(options?: ListSessionsOptions): CopilotSessionRow[];
    readTurns(sessionId: string): CopilotTurnRow[];
    close(): void;
};

/**
 * Open Copilot's session store read-only.
 *
 * Opened with `readonly: true`; SQLite WAL mode lets us read concurrently with
 * the live Copilot extension. A `busy_timeout` covers the brief window where
 * the store might be in a rollback-journal mode mid-write.
 *
 * @throws if the file does not exist or is not a readable SQLite database.
 */
export function openCopilotSessionStore(
    dbPath: string = getDefaultSessionStorePath(),
): CopilotSessionStore {
    if (!fs.existsSync(dbPath)) {
        throw new Error(
            `Copilot session store not found at "${dbPath}". Is GitHub Copilot Chat installed and has it been used in this VS Code flavor?`,
        );
    }

    let db: Database.Database;
    try {
        const nativeBinding = resolveNativeBinding();
        db = new Database(dbPath, {
            readonly: true,
            fileMustExist: true,
            ...(nativeBinding ? { nativeBinding } : {}),
        });
        db.pragma("busy_timeout = 5000");
    } catch (e) {
        throw new Error(
            `Failed to open Copilot session store at "${dbPath}": ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }

    const schemaVersion = readSchemaVersion(db);
    if (
        schemaVersion !== undefined &&
        schemaVersion > MAX_VERIFIED_SCHEMA_VERSION
    ) {
        debug(
            `Copilot session store schema_version=${schemaVersion} is newer than the last verified version (${MAX_VERIFIED_SCHEMA_VERSION}); reading defensively.`,
        );
    }

    return {
        schemaVersion,
        listSessions(options?: ListSessionsOptions): CopilotSessionRow[] {
            return listSessions(db, options);
        },
        readTurns(sessionId: string): CopilotTurnRow[] {
            return readTurns(db, sessionId);
        },
        close(): void {
            try {
                db.close();
            } catch (e) {
                debugError(`Error closing session store: ${e}`);
            }
        },
    };
}

function readSchemaVersion(db: Database.Database): number | undefined {
    try {
        const row = db
            .prepare("SELECT version FROM schema_version LIMIT 1")
            .get() as { version?: number } | undefined;
        return row?.version;
    } catch {
        // Older stores may not have the table; not fatal.
        return undefined;
    }
}

function listSessions(
    db: Database.Database,
    options: ListSessionsOptions = {},
): CopilotSessionRow[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (!options.includeSubagents) {
        conditions.push("s.agent_name = @agentName");
        params.agentName = COPILOT_CHAT_AGENT_NAME;
    }
    if (options.repositoryFilter) {
        conditions.push("s.repository LIKE @repo");
        params.repo = `%${options.repositoryFilter}%`;
    }
    if (options.updatedSince) {
        conditions.push("s.updated_at >= @updatedSince");
        params.updatedSince = options.updatedSince;
    }
    if (options.sessionIds && options.sessionIds.length > 0) {
        // Build a parameterized IN clause (@id0, @id1, …) to keep the query
        // safe from injection while filtering to specific session ids.
        const placeholders = options.sessionIds.map((id, i) => {
            params[`id${i}`] = id;
            return `@id${i}`;
        });
        conditions.push(`s.id IN (${placeholders.join(", ")})`);
    }

    const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
        SELECT
            s.id            AS id,
            s.summary       AS summary,
            s.repository    AS repository,
            s.branch        AS branch,
            s.cwd           AS cwd,
            s.host_type     AS hostType,
            s.agent_name    AS agentName,
            s.created_at    AS createdAt,
            s.updated_at    AS updatedAt,
            (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turnCount
        FROM sessions s
        ${where}
        ORDER BY s.updated_at DESC
    `;

    try {
        return db.prepare(sql).all(params) as CopilotSessionRow[];
    } catch (e) {
        throw new Error(
            `Failed to read sessions from Copilot store (schema may have changed): ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
}

function readTurns(db: Database.Database, sessionId: string): CopilotTurnRow[] {
    const sql = `
        SELECT
            session_id          AS sessionId,
            turn_index          AS turnIndex,
            user_message        AS userMessage,
            assistant_response  AS assistantResponse,
            timestamp           AS timestamp
        FROM turns
        WHERE session_id = @sessionId
        ORDER BY turn_index ASC
    `;
    try {
        return db.prepare(sql).all({ sessionId }) as CopilotTurnRow[];
    } catch (e) {
        throw new Error(
            `Failed to read turns for session "${sessionId}" from Copilot store (schema may have changed): ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
}
