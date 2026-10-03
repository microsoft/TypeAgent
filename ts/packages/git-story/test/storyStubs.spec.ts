// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import {
    SessionWatcher,
    type SessionWatchRequest,
    type NormalizedSessionUpdate,
} from "../src/sessionWatcher.js";
import { StoryBuilder } from "../src/storyBuilder.js";

test("story builder rejects until implemented", async () => {
    await expect(
        new StoryBuilder().build({
            commit: { projectPath: process.cwd(), diff: "", message: "" },
            sessions: [],
        }),
    ).rejects.toThrow("StoryBuilder.build is not implemented");
});

test("session watcher rejects watching until implemented", async () => {
    await expect(
        new SessionWatcher().watch({
            projectPath: process.cwd(),
            sessionId: "session-1",
            transcriptPath: path.resolve("session.jsonl"),
            metadata: { clientName: "Copilot CLI", models: [] },
        }),
    ).rejects.toThrow("SessionWatcher.watch is not implemented");
});

test("session watcher rejects stopping until implemented", async () => {
    await expect(new SessionWatcher().stop()).rejects.toThrow(
        "SessionWatcher.stop is not implemented",
    );
});

const watchRequest: SessionWatchRequest = {
    projectPath: process.cwd(),
    sessionId: "session-1",
    transcriptPath: path.resolve("session.jsonl"),
    metadata: { clientName: "Copilot CLI", models: [] },
};

const sessionUpdate: NormalizedSessionUpdate = {
    projectPath: watchRequest.projectPath,
    sessionId: watchRequest.sessionId,
    events: [
        {
            id: "event-1",
            sourceEventId: "event-1",
            type: "message",
            role: "user",
            text: "Use a queue per repository.",
        },
        {
            id: "event-2",
            sourceEventId: "event-2",
            type: "message",
            role: "agent",
            text: "I will update the queue selection.",
        },
        {
            id: "f497080c-849a-4ab9-a686-5022d6559931",
            type: "session",
            eventType: "internal",
            details: {},
        },
    ],
    metadata: watchRequest.metadata,
};

test.each(["processUpdates", "captureUpdates"] as const)(
    "session watcher rejects %s until implemented",
    async (method) => {
        await expect(
            new SessionWatcher()[method](watchRequest),
        ).rejects.toThrow(`SessionWatcher.${method} is not implemented`);
    },
);

test("session watcher rejects normalization until implemented", () => {
    expect(() =>
        new SessionWatcher().normalizeEvents(watchRequest, {
            records: [],
            nextCheckpoint: {
                sessionId: watchRequest.sessionId,
                transcriptPath: watchRequest.transcriptPath,
                lastReadEventId: null,
                sourceByteOffset: "0",
            },
        }),
    ).toThrow("SessionWatcher.normalizeEvents is not implemented");
});

test("session watcher rejects metadata collection until implemented", () => {
    expect(() =>
        new SessionWatcher().collectMetadata(watchRequest, []),
    ).toThrow("SessionWatcher.collectMetadata is not implemented");
});

test.each(["filterForPrivacy", "publishUpdate"] as const)(
    "session watcher rejects %s rather than passing data through",
    async (method) => {
        await expect(
            new SessionWatcher()[method](sessionUpdate),
        ).rejects.toThrow(`SessionWatcher.${method} is not implemented`);
    },
);
