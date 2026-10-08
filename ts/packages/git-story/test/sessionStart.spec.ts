// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { jest } from "@jest/globals";
import {
    DaemonSessions,
    toSessionWatchRequest,
} from "../src/daemonSessions.js";
import { startServer } from "../src/server/server.js";
import { GitStoryDaemonClient } from "../src/daemonClient.js";
import { LOOPBACK_HOST, SESSIONS_ROUTE } from "../src/daemonApi.js";
import { daemonLogger } from "../src/logger.js";
import {
    captureStatePath,
    loadCaptureState,
} from "../src/sessionCaptureState.js";
import type {
    NormalizedSessionUpdate,
    SessionRegistration,
} from "../src/sessionWatcher.js";

let directory: string;
let manager: DaemonSessions;
let server: Server;
let client: GitStoryDaemonClient;
let url: string;
let token: string;
let delivered: NormalizedSessionUpdate[];
let privacyInputs: NormalizedSessionUpdate[];
let redactEvidence: boolean;

async function until(
    predicate: () => boolean | Promise<boolean>,
): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!(await predicate())) {
        if (Date.now() > deadline)
            throw new Error("Timed out waiting for session status");
        await delay(10);
    }
}

beforeEach(async () => {
    jest.spyOn(daemonLogger, "info").mockImplementation(() => {});
    jest.spyOn(daemonLogger, "error").mockImplementation(() => {});
    directory = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), "git-story-api-")),
    );
    delivered = [];
    privacyInputs = [];
    redactEvidence = false;
    token = randomBytes(32).toString("hex");
    manager = new DaemonSessions({
        stateDirectory: path.join(directory, "state"),
        copilotHome: directory,
        dependencies: {
            privacyFilter: (update) => {
                privacyInputs.push(structuredClone(update));
                return redactEvidence
                    ? {
                          projectPath: "[approved]",
                          sessionId: "approved",
                          events: [],
                          metadata: { clientName: "approved", models: [] },
                      }
                    : update;
            },
            approvedUpdateDestination: (update) => {
                delivered.push(update);
            },
        },
        maxRecords: 2,
        reconcileIntervalMs: 20,
    });
    await serveManager();
});

async function serveManager(): Promise<void> {
    server = await startServer(0, {
        token,
        sessions: manager,
        stop: () => {
            void manager.stop();
        },
    });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("No server address");
    client = new GitStoryDaemonClient(address.port, 2000, token);
    url = `http://${LOOPBACK_HOST}:${address.port}`;
}

async function restartManager(): Promise<void> {
    await manager.stop();
    await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
    manager = new DaemonSessions(manager.options);
    await serveManager();
}

afterEach(async () => {
    await manager.stop().catch(() => {});
    await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
    await fs.rm(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
});

function registration(): SessionRegistration {
    return {
        projectPath: directory,
        sessionId: randomUUID(),
        metadata: {
            clientName: "copilot-cli",
            models: ["seed-model"],
            parentSessionId: "synthetic-parent",
            startedAt: "2026-10-02T08:00:00-07:00",
            lastEventTimestamp: "2026-10-02T16:30:00.123Z",
        },
    };
}

async function source(input: SessionRegistration): Promise<string> {
    const file = toSessionWatchRequest(input, directory)!.transcriptPath;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "");
    return file;
}

test.each([false, true])(
    "client/server preserve complete metadata through real collection with explicit path=%s",
    async (explicit) => {
        const input = registration();
        if (explicit)
            input.transcriptPath = path.join(
                directory,
                "explicit",
                "events.jsonl",
            );
        await source(input);
        expect(await client.registerSession(input)).toMatchObject({
            sessionId: input.sessionId,
            state: "starting",
        });
        await until(() => delivered.length > 0);
        expect(delivered[0].metadata).toEqual(input.metadata);
        expect((await client.sessions())[0].transcriptPath).toBe(
            input.transcriptPath ??
                toSessionWatchRequest(input, directory)!.transcriptPath,
        );
        expect(JSON.stringify(await client.sessions())).not.toContain(
            "seed-model",
        );
    },
);
test.each(["relative.jsonl", null, 42])(
    "invalid explicit transcript %j is rejected by client and server",
    async (transcriptPath) => {
        const input = registration();
        Object.assign(input, { transcriptPath });
        const transport = jest.spyOn(globalThis, "fetch");
        await expect(client.registerSession(input)).rejects.toMatchObject({
            issues: expect.arrayContaining([
                expect.objectContaining({ path: ["transcriptPath"] }),
            ]),
        });
        expect(transport).not.toHaveBeenCalled();
        const response = await fetch(url + SESSIONS_ROUTE, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(input),
        });
        expect(response.status).toBe(400);
        expect(await client.sessions()).toEqual([]);
    },
);

test("minimal registration omits optional metadata without defaults", async () => {
    const input = registration();
    input.metadata = { clientName: "copilot-cli", models: [] };
    await source(input);
    await client.registerSession(input);
    await until(() => delivered.length > 0);
    expect(delivered[0].metadata).toEqual(input.metadata);
});

test.each(["vscode-copilot", "unknown-client"])(
    "%s cannot enable incompatible capture by supplying an explicit source",
    async (clientName) => {
        const input = registration();
        input.metadata.clientName = clientName;
        input.transcriptPath = path.join(directory, "native-transcript.jsonl");
        const contents =
            '{"type":"user","message":{"content":"private-native"}}\n';
        await fs.writeFile(input.transcriptPath, contents);
        const response = await fetch(url + SESSIONS_ROUTE, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
        });
        expect(response.status).toBe(
            clientName === "vscode-copilot" ? 503 : 400,
        );
        expect(await client.sessions()).toEqual([]);
        expect(delivered).toEqual([]);
        await expect(
            fs.stat(path.join(directory, "state", "capture")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(await fs.readFile(input.transcriptPath, "utf8")).toBe(contents);
    },
);

test("actual VS Code hook sends preserved registration but unsupported format never consumes source", async () => {
    const exec = promisify(execFile);
    const env = {
        ...process.env,
        GIT_STORY_STATE_DIR: path.join(directory, "state"),
        GIT_CONFIG_GLOBAL: path.join(directory, "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1",
    };
    await exec("git", ["init", "-q"], { cwd: directory, env });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing server");
    await fs.writeFile(
        path.join(directory, "state", "daemon.json"),
        JSON.stringify({ pid: process.pid, port: address.port, token }),
    );
    const transcript = path.join(directory, "native.jsonl");
    await fs.writeFile(
        transcript,
        '{"type":"user","message":{"content":"native-private"}}\n',
    );
    const admit = jest.spyOn(manager, "register");
    const child = execFile(
        process.execPath,
        [
            fileURLToPath(new URL("../cli.js", import.meta.url)),
            "hooks",
            "vscode",
            "session-start",
        ],
        { cwd: directory, env },
    );
    child.stdin!.end(
        JSON.stringify({
            hook_event_name: "SessionStart",
            session_id: "native-vscode",
            transcript_path: transcript,
        }),
    );
    const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
            let stdout = "",
                stderr = "";
            child.stdout!.on("data", (chunk) => {
                stdout += chunk;
            });
            child.stderr!.on("data", (chunk) => {
                stderr += chunk;
            });
            child.on("error", reject);
            child.on("close", (code) =>
                code === 0
                    ? resolve({ stdout, stderr })
                    : reject(new Error("Hook failed")),
            );
        },
    );
    expect(result.stdout).toBe("{}\n");
    expect(result.stderr).toContain(
        "native transcript capture is not supported",
    );
    expect(admit).toHaveBeenCalledWith(
        expect.objectContaining({
            sessionId: "native-vscode",
            transcriptPath: transcript,
            metadata: { clientName: "vscode-copilot", models: [] },
        }),
    );
    expect(manager.list()).toEqual([]);
    expect(delivered).toEqual([]);
    await expect(
        fs.stat(path.join(directory, "state", "capture")),
    ).rejects.toMatchObject({ code: "ENOENT" });
});

test("explicit missing sources wait, canonical aliases share admission, other IDs cannot own them", async () => {
    const target = path.join(directory, "target");
    const alias = path.join(directory, "alias");
    await fs.mkdir(target);
    await fs.symlink(
        target,
        alias,
        process.platform === "win32" ? "junction" : "dir",
    );
    const input = registration();
    input.transcriptPath = path.join(alias, "missing", "events.jsonl");
    const accepted = await client.registerSession(input);
    expect(accepted.transcriptPath).toBe(
        path.join(target, "missing", "events.jsonl"),
    );
    await until(
        async () => (await client.sessions())[0].status?.phase === "waiting",
    );
    await client.registerSession({
        ...input,
        transcriptPath: accepted.transcriptPath,
    });
    await expect(
        client.registerSession({ ...input, sessionId: "other" }),
    ).rejects.toThrow("already belongs");
    await fs.mkdir(path.dirname(accepted.transcriptPath), { recursive: true });
    await fs.writeFile(
        accepted.transcriptPath,
        '{"id":"appeared","type":"user.message","data":{"content":"fixture"}}\n',
    );
    await until(
        () => delivered.flatMap((update) => update.events).length === 1,
    );
    expect(delivered[0].metadata).toEqual(input.metadata);
    expect(delivered.flatMap((update) => update.events)[0].id).toBe("appeared");
});

test.each(["ENOTDIR", "EACCES"])(
    "unavailable historical source (%s) retains ownership without blocking healthy HTTP admission",
    async (code) => {
        const target = path.join(directory, "reserved");
        const alias = path.join(directory, "reserved-alias");
        await fs.mkdir(target);
        await fs.symlink(
            target,
            alias,
            process.platform === "win32" ? "junction" : "dir",
        );
        const input = {
            ...registration(),
            transcriptPath: path.join(target, "events.jsonl"),
        };
        await client.registerSession(input);
        await until(
            async () =>
                (await client.sessions())[0].status?.phase === "waiting",
        );
        await restartManager();

        const realpath = fsSync.realpathSync.native;
        let restore: () => Promise<void>;
        if (code === "ENOTDIR") {
            await fs.rename(target, target + "-saved");
            await fs.writeFile(target, "fixture obstruction");
            restore = async () => {
                await fs.unlink(target);
                await fs.rename(target + "-saved", target);
            };
        } else {
            // Only this stopped source is inaccessible. No global permissions
            // or asynchronous filesystem methods are changed.
            const probe = jest
                .spyOn(fsSync.realpathSync, "native")
                .mockImplementation((file, options) => {
                    if (file === input.transcriptPath)
                        throw Object.assign(
                            new Error("private filesystem details"),
                            { code },
                        );
                    return realpath(file, options);
                });
            restore = async () => {
                probe.mockRestore();
            };
        }
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                const healthy = registration();
                const file = await source(healthy);
                await fs.writeFile(
                    file,
                    JSON.stringify({
                        id: `healthy-${attempt}`,
                        type: "user.message",
                        data: { content: "healthy fixture" },
                    }) + "\n",
                );
                await client.registerSession(healthy);
                await until(() =>
                    delivered.some((batch) =>
                        batch.events.some(
                            (event) => event.id === `healthy-${attempt}`,
                        ),
                    ),
                );
                const receipt = (await client.sessions()).find(
                    (item) => item.sessionId === input.sessionId,
                )!;
                expect(receipt.transcriptPath).toBe(input.transcriptPath);
                expect(receipt.recoveryRequired).toBe(false);
                expect(JSON.stringify(receipt)).not.toContain(
                    "private filesystem",
                );
                if (code === "EACCES") {
                    await expect(
                        client.registerSession({
                            ...input,
                            sessionId: "duplicate",
                            transcriptPath: path.join(alias, "events.jsonl"),
                        }),
                    ).rejects.toThrow("already belongs");
                }
                if (attempt === 0) await restartManager();
            }
        } finally {
            await restore();
        }
        await expect(
            client.registerSession({
                ...input,
                sessionId: "duplicate",
                transcriptPath: path.join(alias, "events.jsonl"),
            }),
        ).rejects.toThrow("already belongs");
        expect((await client.registerSession(input)).transcriptPath).toBe(
            input.transcriptPath,
        );
    },
);

test("missing source casing keeps persisted capture identity on repeat and restarted registration", async () => {
    const input = {
        ...registration(),
        transcriptPath: path.join(directory, "transcripts", "events.jsonl"),
    };
    const accepted = await client.registerSession(input);
    await until(
        async () => (await client.sessions())[0].status?.phase === "waiting",
    );
    const diskPath =
        process.platform === "win32"
            ? path.join(directory, "Transcripts", "Events.jsonl")
            : input.transcriptPath;
    await fs.mkdir(path.dirname(diskPath));
    const first =
        JSON.stringify({
            type: "user.message",
            data: { content: "first fixture" },
        }) + "\n";
    await fs.writeFile(diskPath, first);
    await until(() => delivered.flatMap((batch) => batch.events).length === 1);
    const firstEvent = delivered.flatMap((batch) => batch.events)[0];
    const stateFile = captureStatePath(
        input.sessionId,
        accepted.transcriptPath,
        path.join(directory, "state", "capture"),
    );
    const before = (await loadCaptureState(stateFile))!;
    expect(before.generatedIds["0"]).toBe(firstEvent.id);
    expect((await client.registerSession(input)).transcriptPath).toBe(
        accepted.transcriptPath,
    );
    expect(
        (await client.registerSession({ ...input, transcriptPath: diskPath }))
            .transcriptPath,
    ).toBe(accepted.transcriptPath);
    await expect(
        client.registerSession({
            ...input,
            metadata: { ...input.metadata, models: ["conflicting"] },
        }),
    ).rejects.toThrow("conflicts");
    const alternateCase = path.join(directory, "TRANSCRIPTS", "EVENTS.JSONL");
    let sameFile = false;
    try {
        sameFile =
            (await fs.realpath(alternateCase)) ===
            (await fs.realpath(diskPath));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const alternateRegistration = client.registerSession({
        ...input,
        transcriptPath: alternateCase,
    });
    if (sameFile) {
        expect((await alternateRegistration).transcriptPath).toBe(
            accepted.transcriptPath,
        );
    } else {
        await expect(alternateRegistration).rejects.toThrow("conflicts");
    }
    await restartManager();
    await fs.appendFile(
        diskPath,
        JSON.stringify({
            type: "user.message",
            data: { content: "second fixture" },
        }) + "\n",
    );
    expect((await client.registerSession(input)).transcriptPath).toBe(
        accepted.transcriptPath,
    );
    await until(async () => {
        const receipt = (await client.sessions())[0];
        return receipt.state === "active" && receipt.status?.phase === "idle";
    });
    const events = delivered.flatMap((batch) => batch.events);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(firstEvent);
    expect(events[1]).toMatchObject({ text: "second fixture" });
    const after = (await loadCaptureState(stateFile))!;
    expect(after.generation).toBe(before.generation);
    expect(after.checkpoint.transcriptPath).toBe(accepted.transcriptPath);
    expect(after.generatedIds).toEqual({
        ...before.generatedIds,
        [Buffer.byteLength(first).toString()]: events[1].id,
    });
    expect(await fs.readdir(path.dirname(stateFile))).toEqual([
        path.basename(stateFile),
    ]);
});

test("authenticated explicit-source pipeline preserves expanded evidence before whole-update privacy", async () => {
    redactEvidence = true;
    const input = registration();
    input.transcriptPath = path.join(directory, "evidence.jsonl");
    const correlation = {
        turnId: "turn",
        parentToolCallId: "parent-tool",
        messageId: "message",
        interactionId: "interaction",
    };
    const records = [
        {
            id: "answer",
            type: "assistant.message",
            parentId: "parent",
            data: {
                ...correlation,
                content: "PRIVATE",
                reasoningText: "OMITTED",
                attachments: [{ type: "file", path: "PRIVATE.ts" }],
                citations: [{ url: "https://example.test/PRIVATE" }],
            },
        },
        {
            id: "external-start",
            type: "external_tool.requested",
            data: {
                ...correlation,
                requestId: "request",
                toolCallId: "tool",
                toolName: "search",
                arguments: { query: "PRIVATE" },
                providerId: null,
            },
        },
        {
            id: "external-receipt",
            type: "external_tool.completed",
            data: { requestId: "request" },
        },
        {
            id: "result",
            type: "tool.execution_complete",
            data: {
                ...correlation,
                toolCallId: "tool",
                success: true,
                mcpMeta: { source: "PRIVATE" },
                result: { content: "PRIVATE", mcpMeta: { source: "PRIVATE" } },
            },
        },
        {
            id: "skill",
            type: "skill.invoked",
            data: { name: "fixture", content: "PRIVATE" },
        },
        {
            id: "notification",
            type: "system.notification",
            data: { kind: "warning", content: "PRIVATE" },
        },
        {
            id: "worker",
            type: "subagent.failed",
            data: { toolCallId: "tool", error: "PRIVATE" },
        },
        {
            id: "chosen",
            type: "session.auto_mode_resolved",
            data: { chosenModel: "chosen" },
        },
        {
            id: "fallback",
            type: "session.fusion_route_failed",
            data: { fallbackModel: "fallback", reason: "PRIVATE" },
        },
        {
            id: "noise",
            type: "assistant.reasoning",
            data: { content: "OMITTED" },
        },
        {
            id: "noise2",
            type: "tool.execution_progress",
            data: { content: "OMITTED" },
        },
    ];
    await fs.writeFile(
        input.transcriptPath,
        records.map((record) => JSON.stringify(record) + "\n").join(""),
    );
    await client.registerSession(input);
    await until(async () => {
        const receipt = (await client.sessions())[0];
        return receipt.state === "active" && receipt.status?.phase === "idle";
    });
    const evidence = privacyInputs.flatMap((update) => update.events);
    expect(evidence.map((event) => event.id)).toEqual(
        records.slice(0, 9).map((record) => record.id),
    );
    expect(evidence[0]).toMatchObject({
        ...correlation,
        parentId: "parent",
        attachments: [{ type: "file", path: "PRIVATE.ts" }],
        citations: [{ url: "https://example.test/PRIVATE" }],
    });
    expect(evidence[1]).toMatchObject({
        type: "tool-start",
        requestId: "request",
        toolCallId: "tool",
    });
    expect(evidence[2]).toMatchObject({
        type: "session",
        eventType: "external_tool.completed",
        details: { requestId: "request" },
    });
    expect(evidence[2]).not.toHaveProperty("success");
    expect(evidence[3]).toMatchObject({
        mcpMeta: { source: "PRIVATE" },
        resultMcpMeta: { source: "PRIVATE" },
    });
    expect(privacyInputs.at(-1)!.metadata.models).toEqual([
        "seed-model",
        "chosen",
        "fallback",
    ]);
    expect(JSON.stringify(privacyInputs)).not.toContain("OMITTED");
    expect(privacyInputs.every((update) => update.events.length <= 2)).toBe(
        true,
    );
    expect(JSON.stringify(delivered)).not.toContain("PRIVATE");
    expect(
        delivered.every(
            (update) =>
                update.projectPath === "[approved]" &&
                update.events.length === 0,
        ),
    ).toBe(true);
    expect((await client.sessions())[0].status?.diagnosticCount).toBe(0);
});

test.each([
    "2026-10-02T08:00:00Z",
    "2026-10-02T08:00:00.123+05:30",
    "2026-10-02T08:00:00-07:00",
])("timestamps retain original timezone: %s", async (timestamp) => {
    const input = registration();
    input.metadata.startedAt = timestamp;
    input.metadata.lastEventTimestamp = timestamp;
    await source(input);
    await client.registerSession(input);
    await until(() => delivered.length > 0);
    expect(delivered[0].metadata).toEqual(input.metadata);
});

test.each([
    ["parentSessionId", 42],
    ["parentSessionId", null],
    ["parentSessionId", {}],
    ["startedAt", null],
    ["startedAt", 42],
    ["startedAt", "not a date"],
    ["startedAt", "2026-10-02"],
    ["startedAt", "2026-10-02T08:00:00"],
    ["startedAt", "2026-99-02T08:00:00Z"],
    ["lastEventTimestamp", false],
    ["lastEventTimestamp", null],
    ["lastEventTimestamp", []],
    ["lastEventTimestamp", ""],
    ["lastEventTimestamp", "2026-10-02T08:00:00"],
    ["lastEventTimestamp", "2026-10-02T99:00:00Z"],
])(
    "invalid metadata %s rejected without echoing values",
    async (field, value) => {
        const input = registration();
        const invalid = {
            ...input,
            metadata: { ...input.metadata, [String(field)]: value },
        };
        const transport = jest.spyOn(globalThis, "fetch");
        await expect(client.registerSession(invalid)).rejects.toMatchObject({
            issues: expect.arrayContaining([
                expect.objectContaining({ path: ["metadata", field] }),
            ]),
        });
        expect(transport).not.toHaveBeenCalled();
        const response = await fetch(url + SESSIONS_ROUTE, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(invalid),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: "Invalid SessionRegistration",
        });
        expect(await client.sessions()).toEqual([]);
    },
);

test.each([
    "../escape",
    "..",
    "a/b",
    "a\\b",
    "C:\\absolute",
    "/absolute",
    "x:ads",
    "NUL",
    "com1.txt",
    "a.",
    "a ",
    "a\nb",
])("rejects unsafe session path %j", async (sessionId) => {
    const response = await fetch(url + SESSIONS_ROUTE, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...registration(), sessionId }),
    });
    expect(response.status).toBe(400);
    expect(await client.sessions()).toEqual([]);
});

test("rejects unauthenticated, browser, rebinding, malformed and oversized requests", async () => {
    const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
    for (const [extra, expected] of [
        [{ Authorization: "" }, 401],
        [{ Origin: "http://localhost" }, 403],
        [{ "Sec-Fetch-Site": "cross-site" }, 403],
        [{ Host: "evil.example" }, 403],
        [{ "Content-Type": "text/plain" }, 415],
    ] as const) {
        const status = await new Promise<number | undefined>(
            (resolve, reject) => {
                const request = httpRequest(
                    url + SESSIONS_ROUTE,
                    {
                        method: "POST",
                        headers: { ...headers, ...extra },
                    },
                    (response) => {
                        response.resume();
                        response.once("end", () =>
                            resolve(response.statusCode),
                        );
                    },
                );
                request.once("error", reject);
                request.end("{}");
            },
        );
        expect(status).toBe(expected);
    }
    expect(
        (
            await fetch(url + SESSIONS_ROUTE, {
                method: "POST",
                headers,
                body: "{",
            })
        ).status,
    ).toBe(400);
    expect(
        (
            await fetch(url + SESSIONS_ROUTE, {
                method: "POST",
                headers,
                body: JSON.stringify({ x: "x".repeat(65536) }),
            })
        ).status,
    ).toBe(413);
    expect(
        (await fetch(url + SESSIONS_ROUTE, { method: "DELETE", headers }))
            .status,
    ).toBe(405);
    const unknown = registration();
    unknown.metadata.clientName = "unknown-private-client";
    await expect(client.registerSession(unknown)).rejects.toThrow(
        "Invalid or unknown session client",
    );
    expect(delivered).toEqual([]);
});

test("waiting admission is idempotent; source appears; conflicting seeds and projects rejected", async () => {
    const input = registration();
    await Promise.all([
        client.registerSession(input),
        client.registerSession(input),
    ]);
    await until(
        async () => (await client.sessions())[0]?.status?.phase === "waiting",
    );
    expect((await client.sessions()).length).toBe(1);
    const file = await source(input);
    await fs.appendFile(
        file,
        JSON.stringify({
            id: "one",
            type: "user.message",
            data: { content: "fixture" },
        }) + "\n",
    );
    await until(() => delivered.flatMap((batch) => batch.events).length === 1);
    await client.registerSession(input);
    await delay(80);
    expect(
        delivered.flatMap((batch) => batch.events).map((event) => event.id),
    ).toEqual(["one"]);
    await expect(
        client.registerSession({
            ...input,
            metadata: { ...input.metadata, models: ["conflict"] },
        }),
    ).rejects.toThrow("conflicts");
    const other = path.join(directory, "other");
    await fs.mkdir(other);
    await expect(
        client.registerSession({ ...input, projectPath: other }),
    ).rejects.toThrow("conflicts");
});

test("missing configuration fails closed before capture, and stop closes admission", async () => {
    await manager.stop();
    const isolated = new DaemonSessions({
        stateDirectory: path.join(directory, "unconfigured"),
        copilotHome: directory,
    });
    const input = registration();
    expect(() => isolated.register(input)).toThrow("not configured");
    await expect(
        fs.stat(path.join(directory, "unconfigured", "capture")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await isolated.stop();
    await expect(client.registerSession(input)).rejects.toThrow("stopping");
});

test("removed replay endpoint is unavailable and does not mutate receipts", async () => {
    const input = registration();
    await source(input);
    await client.registerSession(input);
    await until(async () => (await client.sessions())[0].state === "active");
    const before = await client.sessions();
    const response = await fetch(url + SESSIONS_ROUTE + "/replay", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: "{}",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(await client.sessions()).toEqual(before);
});

test("receipt write failure halts the source and live status retains reporting failure", async () => {
    const input = registration();
    await client.registerSession(input);
    await until(
        async () => (await client.sessions())[0]?.status?.phase === "waiting",
    );
    const receipts = path.join(directory, "state", "sessions");
    await fs.rename(receipts, receipts + "-saved");
    await fs.writeFile(receipts, "fixture obstruction");
    const file = await source(input);
    await fs.appendFile(
        file,
        '{"type":"user.message","data":{"content":"must not deliver"}}\n',
    );
    await until(
        async () =>
            (await client.sessions())[0]?.status?.failure?.stage ===
            "reporting",
    );
    expect(delivered).toEqual([]);
    expect((await client.sessions())[0].status?.reportingFailed).toBe(true);
});

test("authenticated existing Git commit reads keep their response contract", async () => {
    const exec = promisify(execFile);
    const options = {
        cwd: directory,
        env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: path.join(directory, "gitconfig"),
            GIT_CONFIG_NOSYSTEM: "1",
        },
    };
    await exec("git", ["init", "-q"], options);
    await exec(
        "git",
        [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "-c",
            `core.hooksPath=${path.join(directory, "empty-hooks")}`,
            "commit",
            "--allow-empty",
            "-m",
            "fixture subject",
        ],
        options,
    );
    const hash = (
        await exec("git", ["rev-parse", "HEAD"], options)
    ).stdout.trim();
    expect(await client.storyCommit(directory, hash.slice(0, 8))).toEqual({
        hash,
        subject: "fixture subject",
    });
});
