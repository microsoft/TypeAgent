// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import { toSessionWatchRequest } from "../src/server/routes/sessionsApiHandler.js";

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
