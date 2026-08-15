// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { captureMacroRecording } from "../src/hooks/hook-history.js";

describe("macro recording capture", () => {
    it("ignores an unavailable agent-server", async () => {
        await expect(
            captureMacroRecording(
                {
                    sessionId: "session-1",
                    timestamp: 1,
                    cwd: ".",
                    transcriptPath: "unused",
                    stopReason: "complete",
                },
                async () => {
                    throw new Error("connection refused");
                },
            ),
        ).resolves.toBeUndefined();
    });
});
