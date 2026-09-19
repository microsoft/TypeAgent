// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { joinSession } from "@github/copilot-sdk/extension";
import type { SessionEvent } from "@github/copilot-sdk";
import { createExtensionCommands } from "./commands.js";
import { getPowerShellHookOutput } from "./powershell-guidance.js";
import { SessionCapture } from "./session-capture.js";

let sessionLog: ((message: string) => Promise<void>) | undefined;
const commands = createExtensionCommands(async (message) => {
    if (!sessionLog) throw new Error("TypeAgent extension is not ready.");
    await sessionLog(message);
});

const session = await joinSession({
    requestedEnvironmentVariables: ["TYPEAGENT_TUNNEL_TOKEN"],
    commands,
    hooks: {
        onPreToolUse: (input) =>
            getPowerShellHookOutput(input.toolName, input.toolArgs),
    },
});
sessionLog = (message) => session.log(message);

const capture = new SessionCapture(
    session.sessionId,
    process.cwd(),
    (message) => console.error(message),
);

await capture.failInterruptedRecording();
session.on((event: SessionEvent) =>
    capture.enqueue({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        data: event.data as unknown as Record<string, unknown>,
        ...(event.agentId ? { agentId: event.agentId } : {}),
    }),
);
