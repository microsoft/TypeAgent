// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import {
    sessions,
    toSessionWatchRequest,
} from "../src/server/routes/sessionsApiHandler.js";
import { route } from "../src/server/router.js";
import { GitStoryDaemonClient } from "../src/daemonClient.js";
import { LOOPBACK_HOST, SESSIONS_ROUTE } from "../src/daemonApi.js";
import { daemonLogger } from "../src/logger.js";
import {
    SessionWatcher,
    type SessionRegistration,
} from "../src/sessionWatcher.js";

const server = createServer(route);
let client: GitStoryDaemonClient;
let url: string;

beforeAll(async () => {
    await once(server.listen(0, LOOPBACK_HOST), "listening");
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Expected loopback server address");
    client = new GitStoryDaemonClient(address.port, 2000);
    url = `http://${LOOPBACK_HOST}:${address.port}${SESSIONS_ROUTE}`;
});

beforeEach(() => {
    jest.spyOn(daemonLogger, "info").mockImplementation(() => {});
});

afterEach(() => {
    sessions.clear();
    jest.restoreAllMocks();
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

function registration(): SessionRegistration {
    return {
        projectPath: process.cwd(),
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

// The daemon derives transcriptPath from the client; unknown clients get none.
test("registration maps to SessionWatchRequest by client", () => {
    const registration = {
        projectPath: "/repo",
        sessionId: "s7",
        metadata: { clientName: "copilot-cli", models: [] },
    };
    expect(toSessionWatchRequest(registration)).toEqual({
        ...registration,
        transcriptPath: path.join(
            os.homedir(),
            ".copilot/session-state/s7/events.jsonl",
        ),
    });
    const unknown = {
        ...registration,
        metadata: { clientName: "x", models: [] },
    };
    expect(toSessionWatchRequest(unknown)).toBeUndefined();
});

test.each([false, true])(
    "client and server preserve metadata with explicit transcript=%s as collector and replay seeds",
    async (explicitTranscript) => {
        const input = registration();
        if (explicitTranscript) {
            input.transcriptPath = path.resolve(
                "synthetic-vscode",
                "events.jsonl",
            );
            input.metadata.clientName = "vscode-copilot";
        }
        await expect(client.registerSession(input)).resolves.toEqual({
            sessionId: input.sessionId,
        });
        const registered = sessions.get(input.sessionId);
        expect(registered?.metadata).toEqual(input.metadata);
        if (!registered) throw new Error("Expected registered session");
        if (explicitTranscript)
            expect(registered.transcriptPath).toBe(input.transcriptPath);
        const directory = await fs.mkdtemp(
            path.join(os.tmpdir(), "git-story-registration-"),
        );
        try {
            const request = {
                ...registered,
                transcriptPath: path.join(directory, "events.jsonl"),
            };
            await fs.writeFile(request.transcriptPath, "");
            const watcher = new SessionWatcher();
            const options = { stateDirectory: path.join(directory, "capture") };
            const captured = await watcher.captureUpdates(
                request,
                undefined,
                options,
            );
            const state = watcher.collectMetadata(
                request,
                watcher.normalizeEvents(request, captured),
            );
            expect(state.metadata).toEqual(input.metadata);
            const restored = await watcher.restoreMetadata(
                request,
                captured.nextCheckpoint,
                captured.generation,
                options,
            );
            expect(restored.state.metadata).toEqual(input.metadata);
            expect(restored.diagnostics).toEqual([]);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
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
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        expect(response.status).toBe(400);
        expect(sessions.has(input.sessionId)).toBe(false);
    },
);

test("minimal registration omits optional metadata without adding defaults", async () => {
    const input = registration();
    input.metadata = { clientName: "copilot-cli", models: [] };
    await client.registerSession(input);
    expect(sessions.get(input.sessionId)?.metadata).toEqual(input.metadata);
});

test.each([
    "2026-10-02T08:00:00Z",
    "2026-10-02T08:00:00.123+05:30",
    "2026-10-02T08:00:00-07:00",
])(
    "registration timestamps retain their original timezone representation: %s",
    async (timestamp) => {
        const input = registration();
        input.metadata.startedAt = timestamp;
        input.metadata.lastEventTimestamp = timestamp;
        await client.registerSession(input);
        expect(sessions.get(input.sessionId)?.metadata).toEqual(input.metadata);
    },
);

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
    "invalid %s=%j is rejected by both client and server",
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
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(invalid),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: expect.stringContaining("Invalid SessionRegistration"),
        });
        expect(sessions.has(input.sessionId)).toBe(false);
    },
);
