// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionEvent } from "@github/copilot-sdk";
import { createExtensionCommands } from "./commands.js";
import { getPowerShellHookOutput } from "./powershell-guidance.js";
import { SessionCapture } from "./session-capture.js";
import { joinTypeAgentSession } from "./session-host.js";
import { executeNativeMacro, MacroRunnerObserver } from "./macro-runner.js";
import { startMacroRunnerBridge } from "../shared/macro-runner-bridge.js";
import { validateMacroHandoff } from "../shared/macro-handoff.js";
import { connectToAgentServer } from "../shared/typeagent-client.js";

const runnerObserver = new MacroRunnerObserver();

let sessionLog: ((message: string) => Promise<void>) | undefined;
let sessionSend: ((task: string) => Promise<void>) | undefined;
const commands = createExtensionCommands(
    async (message) => {
        if (!sessionLog) throw new Error("TypeAgent extension is not ready.");
        await sessionLog(message);
    },
    async (task) => {
        if (!sessionSend) throw new Error("TypeAgent extension is not ready.");
        await sessionSend(task);
    },
);

const lifecycle = await joinTypeAgentSession({
    requestedEnvironmentVariables: ["TYPEAGENT_TUNNEL_TOKEN"],
    commands,
    hooks: {
        onPreToolUse: (input) =>
            runnerObserver.guard(input.sessionId, input.toolName) ??
            getPowerShellHookOutput(input.toolName, input.toolArgs),
    },
});
const session = lifecycle.session;
session.on((event) => runnerObserver.record(event));
session.on("session.shutdown", () => runnerObserver.close());
process.once("exit", () => runnerObserver.close());
const closeBridge = await startMacroRunnerBridge(
    session.sessionId,
    async (handoff, submittedAt, signal) => {
        if (typeof session.rpc.tools?.execute !== "function") {
            throw new Error(
                "Host macro execution requires the native tools.execute API.",
            );
        }
        validateMacroHandoff(handoff);
        try {
            return await executeNativeMacro(
                handoff.payload,
                submittedAt,
                signal,
                runnerObserver,
                {
                    inspect: async (request) => {
                        const connection = await connectToAgentServer();
                        try {
                            return await connection.inspectMacro(request);
                        } finally {
                            await connection.close();
                        }
                    },
                    execute: (request) => session.rpc.tools.execute(request),
                    cancel: (request) => session.rpc.tasks.cancel(request),
                    subscribe: (handler) => session.on(handler),
                },
            );
        } finally {
            await session.log(runnerObserver.report());
        }
    },
    (message) => console.error(message),
);
session.on("session.shutdown", closeBridge);
process.once("exit", closeBridge);
process.once("SIGINT", () => void lifecycle.close());
process.once("SIGTERM", () => void lifecycle.close());
process.once("exit", () => lifecycle.closeSync());
sessionLog = (message) => session.log(message);
sessionSend = async (task) => {
    await session.send({ prompt: task });
};

const capture = new SessionCapture(
    session.sessionId,
    process.cwd(),
    (message) => console.error(message),
    undefined,
    (message) => session.log(message),
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
