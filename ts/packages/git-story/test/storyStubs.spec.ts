// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { SessionWatcher } from "../src/sessionWatcher.js";
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
