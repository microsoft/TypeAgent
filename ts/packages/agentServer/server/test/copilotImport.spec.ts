// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, test } from "@jest/globals";
import Database from "better-sqlite3";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { DispatcherOptions } from "agent-dispatcher";

import { createConversationManager } from "../src/conversationManager.js";
import {
    COPILOT_CHAT_AGENT_NAME,
    openCopilotSessionStore,
} from "../src/copilot/sessionStoreReader.js";
import {
    COPILOT_SOURCE,
    synthesizeDisplayLog,
    synthesizeRequestId,
} from "../src/copilot/displayLogSynthesis.js";
import {
    deriveMirrorName,
    importCopilotSessions,
} from "../src/copilot/mirrorImporter.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), "copilot-import-test-"),
    );
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(
        tempDirs
            .splice(0)
            .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
});

type SeedTurn = {
    turnIndex: number;
    userMessage: string | null;
    assistantResponse: string | null;
    timestamp: string;
};

type SeedSession = {
    id: string;
    summary?: string | null;
    repository?: string | null;
    branch?: string | null;
    cwd?: string | null;
    hostType?: string | null;
    agentName?: string | null;
    createdAt: string;
    updatedAt: string;
    turns?: SeedTurn[];
};

/**
 * Build a throwaway SQLite database that mirrors the real Copilot
 * `session-store.db` schema (schema_version = 3) and seed it.
 */
async function createSeededStore(sessions: SeedSession[]): Promise<string> {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "session-store.db");
    const db = new Database(dbPath);

    db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            cwd TEXT,
            repository TEXT,
            host_type TEXT,
            branch TEXT,
            summary TEXT,
            agent_name TEXT,
            agent_description TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE turns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            turn_index INTEGER NOT NULL,
            user_message TEXT,
            assistant_response TEXT,
            timestamp TEXT,
            UNIQUE(session_id, turn_index)
        );
    `);
    db.prepare("INSERT INTO schema_version (version) VALUES (3)").run();

    const insertSession = db.prepare(`
        INSERT INTO sessions
            (id, cwd, repository, host_type, branch, summary, agent_name, agent_description, created_at, updated_at)
        VALUES
            (@id, @cwd, @repository, @hostType, @branch, @summary, @agentName, NULL, @createdAt, @updatedAt)
    `);
    const insertTurn = db.prepare(`
        INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
        VALUES (@sessionId, @turnIndex, @userMessage, @assistantResponse, @timestamp)
    `);

    for (const s of sessions) {
        insertSession.run({
            id: s.id,
            cwd: s.cwd ?? null,
            repository: s.repository ?? null,
            hostType: s.hostType ?? "vscode",
            branch: s.branch ?? null,
            summary: s.summary ?? null,
            agentName: s.agentName ?? COPILOT_CHAT_AGENT_NAME,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
        });
        for (const t of s.turns ?? []) {
            insertTurn.run({
                sessionId: s.id,
                turnIndex: t.turnIndex,
                userMessage: t.userMessage,
                assistantResponse: t.assistantResponse,
                timestamp: t.timestamp,
            });
        }
    }
    db.close();
    return dbPath;
}

describe("CopilotSessionStore reader", () => {
    test("reports schema version", async () => {
        const dbPath = await createSeededStore([]);
        const store = openCopilotSessionStore(dbPath);
        expect(store.schemaVersion).toBe(3);
        store.close();
    });

    test("excludes subagent sessions by default", async () => {
        const dbPath = await createSeededStore([
            {
                id: "chat-1",
                summary: "real chat",
                repository: "https://github.com/microsoft/TypeAgent.git",
                createdAt: "2026-06-01T10:00:00.000Z",
                updatedAt: "2026-06-01T10:30:00.000Z",
                turns: [
                    {
                        turnIndex: 0,
                        userMessage: "hi",
                        assistantResponse: "hello",
                        timestamp: "2026-06-01T10:00:00.000Z",
                    },
                ],
            },
            {
                id: "edit-1",
                summary: "inline edit",
                agentName: "panel/editAgent",
                createdAt: "2026-06-01T11:00:00.000Z",
                updatedAt: "2026-06-01T11:30:00.000Z",
            },
        ]);
        const store = openCopilotSessionStore(dbPath);

        const sessions = store.listSessions();
        expect(sessions.map((s) => s.id)).toEqual(["chat-1"]);
        expect(sessions[0].turnCount).toBe(1);

        const withSubagents = store.listSessions({ includeSubagents: true });
        expect(withSubagents.map((s) => s.id).sort()).toEqual([
            "chat-1",
            "edit-1",
        ]);
        store.close();
    });

    test("filters by repository substring and orders by updated_at desc", async () => {
        const dbPath = await createSeededStore([
            {
                id: "ta-1",
                repository: "https://github.com/microsoft/TypeAgent.git",
                createdAt: "2026-06-01T10:00:00.000Z",
                updatedAt: "2026-06-01T10:00:00.000Z",
            },
            {
                id: "ta-2",
                repository: "https://github.com/microsoft/TypeAgent.git",
                createdAt: "2026-06-02T10:00:00.000Z",
                updatedAt: "2026-06-02T10:00:00.000Z",
            },
            {
                id: "other-1",
                repository: "https://github.com/other/repo.git",
                createdAt: "2026-06-03T10:00:00.000Z",
                updatedAt: "2026-06-03T10:00:00.000Z",
            },
        ]);
        const store = openCopilotSessionStore(dbPath);

        const sessions = store.listSessions({
            repositoryFilter: "TypeAgent",
        });
        expect(sessions.map((s) => s.id)).toEqual(["ta-2", "ta-1"]);
        store.close();
    });

    test("reads turns ordered by turn_index", async () => {
        const dbPath = await createSeededStore([
            {
                id: "s1",
                createdAt: "2026-06-01T10:00:00.000Z",
                updatedAt: "2026-06-01T10:00:00.000Z",
                turns: [
                    {
                        turnIndex: 2,
                        userMessage: "third",
                        assistantResponse: "c",
                        timestamp: "2026-06-01T10:02:00.000Z",
                    },
                    {
                        turnIndex: 0,
                        userMessage: "first",
                        assistantResponse: "a",
                        timestamp: "2026-06-01T10:00:00.000Z",
                    },
                    {
                        turnIndex: 1,
                        userMessage: "second",
                        assistantResponse: "b",
                        timestamp: "2026-06-01T10:01:00.000Z",
                    },
                ],
            },
        ]);
        const store = openCopilotSessionStore(dbPath);
        const turns = store.readTurns("s1");
        expect(turns.map((t) => t.turnIndex)).toEqual([0, 1, 2]);
        expect(turns.map((t) => t.userMessage)).toEqual([
            "first",
            "second",
            "third",
        ]);
        store.close();
    });

    test("throws a clear error when the file does not exist", () => {
        expect(() =>
            openCopilotSessionStore(
                path.join(os.tmpdir(), "does-not-exist-12345.db"),
            ),
        ).toThrow(/not found/i);
    });
});

describe("synthesizeDisplayLog", () => {
    const turns = [
        {
            sessionId: "s1",
            turnIndex: 0,
            userMessage: "how do I build?",
            assistantResponse: "Run `pnpm run build`.",
            timestamp: "2026-06-01T10:00:00.000Z",
        },
        {
            sessionId: "s1",
            turnIndex: 1,
            userMessage: "and test?",
            assistantResponse: "Run `pnpm run test:local`.",
            timestamp: "2026-06-01T10:01:00.000Z",
        },
    ];

    test("produces a user-request + set-display pair per turn", () => {
        const entries = synthesizeDisplayLog("s1", turns);
        expect(entries).toHaveLength(4);
        expect(entries.map((e) => e.type)).toEqual([
            "user-request",
            "set-display",
            "user-request",
            "set-display",
        ]);
    });

    test("assigns contiguous sequence numbers", () => {
        const entries = synthesizeDisplayLog("s1", turns);
        expect(entries.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    });

    test("groups each user/agent pair under one shared requestId", () => {
        const entries = synthesizeDisplayLog("s1", turns);
        const userEntry = entries[0];
        const agentEntry = entries[1];
        if (
            userEntry.type !== "user-request" ||
            agentEntry.type !== "set-display"
        ) {
            throw new Error("unexpected entry types");
        }
        expect(userEntry.requestId).toEqual(synthesizeRequestId("s1", 0));
        expect(agentEntry.message.requestId).toEqual(userEntry.requestId);
        expect(userEntry.command).toBe("how do I build?");
        expect(agentEntry.message.message).toEqual({
            type: "markdown",
            content: "Run `pnpm run build`.",
        });
        expect(agentEntry.message.source).toBe(COPILOT_SOURCE);
    });

    test("converts ISO timestamps to epoch milliseconds", () => {
        const entries = synthesizeDisplayLog("s1", turns);
        expect(entries[0].timestamp).toBe(
            Date.parse("2026-06-01T10:00:00.000Z"),
        );
        expect(entries[2].timestamp).toBe(
            Date.parse("2026-06-01T10:01:00.000Z"),
        );
    });

    test("is deterministic across runs (idempotent imports)", () => {
        expect(synthesizeDisplayLog("s1", turns)).toEqual(
            synthesizeDisplayLog("s1", turns),
        );
    });

    test("tolerates null messages", () => {
        const entries = synthesizeDisplayLog("s2", [
            {
                sessionId: "s2",
                turnIndex: 0,
                userMessage: null,
                assistantResponse: null,
                timestamp: "2026-06-01T10:00:00.000Z",
            },
        ]);
        const userEntry = entries[0];
        const agentEntry = entries[1];
        if (
            userEntry.type !== "user-request" ||
            agentEntry.type !== "set-display"
        ) {
            throw new Error("unexpected entry types");
        }
        expect(userEntry.command).toBe("");
        expect(agentEntry.message.message).toEqual({
            type: "markdown",
            content: "",
        });
    });
});

describe("deriveMirrorName", () => {
    const base = {
        id: "x",
        repository: null,
        cwd: null,
        hostType: "vscode",
        agentName: COPILOT_CHAT_AGENT_NAME,
        updatedAt: "2026-06-01T10:00:00.000Z",
        turnCount: 1,
    };

    test("uses the first non-empty line of the summary", () => {
        expect(
            deriveMirrorName({
                ...base,
                summary: "\n  fix the build  \nmore detail",
                branch: "main",
                createdAt: "2026-06-01T10:00:00.000Z",
            }),
        ).toBe("fix the build");
    });

    test("falls back to branch and date when summary is empty", () => {
        expect(
            deriveMirrorName({
                ...base,
                summary: "   ",
                branch: "dev/feature",
                createdAt: "2026-06-01T10:00:00.000Z",
            }),
        ).toBe("dev/feature — 2026-06-01");
    });

    test("falls back to a generic name when no branch", () => {
        expect(
            deriveMirrorName({
                ...base,
                summary: null,
                branch: null,
                createdAt: "2026-06-01T10:00:00.000Z",
            }),
        ).toBe("Copilot session — 2026-06-01");
    });
});

describe("importCopilotSessions", () => {
    async function createManager(baseDir: string) {
        return createConversationManager(
            "test-host",
            {} as DispatcherOptions,
            baseDir,
        );
    }

    test("imports sessions as read-only copilot mirrors with a display log", async () => {
        const dbPath = await createSeededStore([
            {
                id: "sess-a",
                summary: "add a login form",
                repository: "https://github.com/microsoft/TypeAgent.git",
                branch: "main",
                createdAt: "2026-06-01T10:00:00.000Z",
                updatedAt: "2026-06-01T10:30:00.000Z",
                turns: [
                    {
                        turnIndex: 0,
                        userMessage: "add login",
                        assistantResponse: "Done.",
                        timestamp: "2026-06-01T10:00:00.000Z",
                    },
                    {
                        turnIndex: 1,
                        userMessage: "add validation",
                        assistantResponse: "Added.",
                        timestamp: "2026-06-01T10:05:00.000Z",
                    },
                ],
            },
        ]);
        const baseDir = await createTempDir();
        const manager = await createManager(baseDir);
        try {
            const result = await importCopilotSessions(manager, { dbPath });
            expect(result.total).toBe(1);
            expect(result.imported).toBe(1);
            expect(result.skipped).toBe(0);

            const conversations = manager.listConversations();
            expect(conversations).toHaveLength(1);
            const mirror = conversations[0];
            expect(mirror.source).toBe("copilot");
            expect(mirror.readOnly).toBe(true);
            expect(mirror.name).toBe("add a login form");

            // Display log persisted for normal replay on join.
            const logPath = path.join(
                baseDir,
                "conversations",
                mirror.conversationId,
                "displayLog.json",
            );
            const entries = JSON.parse(await fs.readFile(logPath, "utf-8"));
            expect(entries).toEqual(
                synthesizeDisplayLog("sess-a", [
                    {
                        sessionId: "sess-a",
                        turnIndex: 0,
                        userMessage: "add login",
                        assistantResponse: "Done.",
                        timestamp: "2026-06-01T10:00:00.000Z",
                    },
                    {
                        sessionId: "sess-a",
                        turnIndex: 1,
                        userMessage: "add validation",
                        assistantResponse: "Added.",
                        timestamp: "2026-06-01T10:05:00.000Z",
                    },
                ]),
            );
        } finally {
            await manager.close();
        }
    });

    test("is idempotent: re-importing skips existing mirrors", async () => {
        const dbPath = await createSeededStore([
            {
                id: "sess-a",
                summary: "first",
                createdAt: "2026-06-01T10:00:00.000Z",
                updatedAt: "2026-06-01T10:30:00.000Z",
                turns: [
                    {
                        turnIndex: 0,
                        userMessage: "hi",
                        assistantResponse: "hello",
                        timestamp: "2026-06-01T10:00:00.000Z",
                    },
                ],
            },
            {
                id: "sess-b",
                summary: "second",
                createdAt: "2026-06-02T10:00:00.000Z",
                updatedAt: "2026-06-02T10:30:00.000Z",
                turns: [
                    {
                        turnIndex: 0,
                        userMessage: "yo",
                        assistantResponse: "hey",
                        timestamp: "2026-06-02T10:00:00.000Z",
                    },
                ],
            },
        ]);
        const baseDir = await createTempDir();
        const manager = await createManager(baseDir);
        try {
            const first = await importCopilotSessions(manager, { dbPath });
            expect(first.imported).toBe(2);

            const second = await importCopilotSessions(manager, { dbPath });
            expect(second.imported).toBe(0);
            expect(second.skipped).toBe(2);

            // Still exactly two conversations, no duplicates.
            expect(manager.listConversations()).toHaveLength(2);
        } finally {
            await manager.close();
        }
    });

    test("skips sessions with no turns", async () => {
        const dbPath = await createSeededStore([
            {
                id: "empty",
                summary: "nothing here",
                createdAt: "2026-06-01T10:00:00.000Z",
                updatedAt: "2026-06-01T10:00:00.000Z",
            },
        ]);
        const baseDir = await createTempDir();
        const manager = await createManager(baseDir);
        try {
            const result = await importCopilotSessions(manager, { dbPath });
            expect(result.total).toBe(1);
            expect(result.imported).toBe(0);
            expect(manager.listConversations()).toHaveLength(0);
        } finally {
            await manager.close();
        }
    });
});
