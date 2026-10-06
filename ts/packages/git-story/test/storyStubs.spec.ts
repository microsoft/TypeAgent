// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import {
    SessionWatcher,
    type SessionWatchRequest,
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

test.each(["processUpdates"] as const)(
    "session watcher rejects %s until implemented",
    async (method) => {
        await expect(
            new SessionWatcher()[method](watchRequest),
        ).rejects.toThrow(`SessionWatcher.${method} is not implemented`);
    },
);
