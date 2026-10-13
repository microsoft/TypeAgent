// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { jest } from "@jest/globals";
import {
    DaemonSessions,
    toSessionWatchRequest,
} from "../src/daemonSessions.js";
import { daemonLogger } from "../src/logger.js";
import type { DaemonSessionDependencies } from "../src/daemonComposition.js";
import type {
    NormalizedSessionUpdate,
    SessionRegistration,
} from "../src/sessionWatcher.js";

let directory: string;
let instances: DaemonSessions[];
let input: SessionRegistration;
let delivered: NormalizedSessionUpdate[];
let dependencies: DaemonSessionDependencies;
const message = (id?: string) => ({
    ...(id ? { id } : {}),
    type: "user.message",
    data: { content: "fixture" },
});

async function until(predicate: () => boolean) {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
        if (Date.now() >= deadline)
            throw new Error("Timed out waiting for status");
        await delay(10);
    }
}
function manager(state = "state") {
    const sessions = new DaemonSessions({
        stateDirectory: path.join(directory, state),
        copilotHome: directory,
        dependencies,
        maxRecords: 2,
        reconcileIntervalMs: 20,
    });
    instances.push(sessions);
    return sessions;
}
async function append(...records: unknown[]) {
    const transcript = toSessionWatchRequest(input, directory)!.transcriptPath;
    await fs.mkdir(path.dirname(transcript), { recursive: true });
    await fs.appendFile(
        transcript,
        records.map((record) => JSON.stringify(record) + "\n").join(""),
    );
}

beforeEach(async () => {
    jest.spyOn(daemonLogger, "error").mockImplementation(() => {});
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "git-story-failure-"));
    input = {
        projectPath: directory,
        sessionId: "fixture-session",
        metadata: { clientName: "copilot-cli", models: [] },
    };
    instances = [];
    delivered = [];
    dependencies = {
        privacyFilter: (update) => update,
        approvedUpdateDestination: (update) => {
            delivered.push(update);
        },
    };
});
afterEach(async () => {
    await Promise.all(instances.map((sessions) => sessions.stop()));
    await fs.rm(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
});

test("known failure remains blocked across repeated restarts without skipping its undelivered batch", async () => {
    dependencies.approvedUpdateDestination = () => {
        throw new Error("private dependency error");
    };
    const first = manager();
    await append(message(), message(), message("later"));
    first.register(input);
    await until(() => first.list()[0]?.status?.failure !== undefined);
    const failure = first.list()[0].status!.failure!;
    expect(failure.stage).toBe("delivery");
    await first.stop();
    const receipts = path.join(directory, "state", "sessions");
    const file = path.join(receipts, (await fs.readdir(receipts))[0]);
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    // Receipts written before simplification may include replay-only history.
    const checkpoint = {
        sessionId: input.sessionId,
        transcriptPath: toSessionWatchRequest(input, directory)!.transcriptPath,
        sourceByteOffset: "0",
    };
    Object.assign(saved.receipt.status.failure, {
        generation: "legacy-generation",
        fromCheckpoint: checkpoint,
        throughCheckpoint: checkpoint,
    });
    Object.assign(saved.receipt, {
        previousFailure: saved.receipt.status.failure,
        recoveryReason: "failure",
        sourceUnavailable: true,
    });
    await fs.writeFile(file, JSON.stringify(saved));
    dependencies.approvedUpdateDestination = (update) => {
        delivered.push(update);
    };
    for (let restart = 0; restart < 2; restart++) {
        const next = manager();
        expect(next.register(input)).toMatchObject({
            state: "blocked",
            recoveryRequired: true,
            status: { failure },
        });
        expect(next.list()[0]).not.toHaveProperty("previousFailure");
        expect(next.list()[0]).not.toHaveProperty("recoveryReason");
        expect(next.list()[0]).not.toHaveProperty("sourceUnavailable");
        expect(next.list()[0].status!.failure).toEqual(failure);
        await append(message("unread"));
        await delay(70);
        expect(delivered).toEqual([]);
        expect(next.list()[0].status?.monitoring).toBe(false);
        await next.stop();
    }
});

test.each([false, true])(
    "interrupted delivery stays blocked, including a persisted end cursor (diagnostics=%s)",
    async (diagnostics) => {
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => {
            release = resolve;
        });
        dependencies.approvedUpdateDestination = async (update) => {
            delivered.push(update);
            await waiting;
        };
        const first = manager();
        await append(
            ...(diagnostics ? [{ type: "unsupported.fixture", data: {} }] : []),
            message(),
        );
        first.register(input);
        try {
            await until(() => delivered.length === 1);
            expect(delivered[0].events).toHaveLength(1);
            // Snapshot only durable state during real pending delivery, then
            // drain the original before opening it with another manager.
            await fs.cp(
                path.join(directory, "state"),
                path.join(directory, "snapshot"),
                { recursive: true },
            );
        } finally {
            release();
            await first.stop();
        }
        delivered.length = 0;
        const second = manager("snapshot");
        const receipt = second.register(input);
        expect(receipt).toMatchObject({
            state: "blocked",
            recoveryRequired: true,
            status: { phase: "processing", monitoring: false },
        });
        if (diagnostics)
            expect(
                Number(receipt.status?.readCheckpoint?.sourceByteOffset),
            ).toBeGreaterThan(0);
        await append(message("after-interruption"));
        await delay(70);
        expect(delivered).toEqual([]);
        await second.stop();
        const third = manager("snapshot");
        expect(third.register(input).state).toBe("blocked");
        await delay(70);
        expect(delivered).toEqual([]);
    },
);

test("stop rejects registrations and waits for admitted delivery", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    dependencies.approvedUpdateDestination = async (update) => {
        delivered.push(update);
        await waiting;
    };
    const sessions = manager();
    await append(message("drain"));
    sessions.register(input);
    await until(() => delivered.length === 1);
    let stopped = false;
    const stopping = sessions.stop().then(() => {
        stopped = true;
    });
    try {
        expect(() =>
            sessions.register({ ...input, sessionId: "other" }),
        ).toThrow("stopping");
        await delay(50);
        expect(stopped).toBe(false);
    } finally {
        release();
        await stopping;
    }
    expect(sessions.list()[0].status?.monitoring).toBe(false);
    await append(message("after-stop"));
    await delay(60);
    expect(delivered).toHaveLength(1);
});

test("canonical project aliases are idempotent and case aliases cannot own the same Windows source", async () => {
    const sessions = manager();
    sessions.register(input);
    await until(() => sessions.list()[0].status?.phase === "waiting");
    expect(() =>
        sessions.register({ ...input, projectPath: path.join(directory, ".") }),
    ).not.toThrow();
    if (process.platform === "win32")
        expect(() =>
            sessions.register({
                ...input,
                sessionId: input.sessionId.toUpperCase(),
            }),
        ).toThrow("conflicts");
    expect(sessions.list()).toHaveLength(1);
});
