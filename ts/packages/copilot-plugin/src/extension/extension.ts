// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionEvent } from "@github/copilot-sdk";
import {
    assertControlBinding,
    controlDiagnosticEnabled,
    publishControlMetadata,
} from "../shared/control-metadata.js";
import { connectToAgentServer } from "../shared/typeagent-client.js";
import { createExtensionCommands } from "./commands.js";
import { runControlDiagnostic } from "./control-diagnostic.js";
import { getPowerShellHookOutput } from "./powershell-guidance.js";
import { SessionCapture } from "./session-capture.js";
import { joinTypeAgentSession } from "./session-host.js";
import {
    initializeWorkiqNativeSession,
    publishWorkiqFinalizedCapture,
    publishWorkiqNativeRecord,
    publishWorkiqSessionKnown,
} from "./workiq-native-session.js";
import {
    observeWorkiqToolOriginals,
    waitForWorkiqCapturePolicy,
    workiqCapturePolicyPath,
} from "./workiq-originals.js";
let workiqOriginals: Awaited<ReturnType<typeof observeWorkiqToolOriginals>>;

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

const initialControl = publishControlMetadata("native-extension-startup");
assertControlBinding(initialControl);
const workiqPolicy = await workiqCapturePolicyPath(initialControl);

const lifecycle = await joinTypeAgentSession({
    requestedEnvironmentVariables: ["TYPEAGENT_TUNNEL_TOKEN"],
    commands,
    hooks: {
        onPreToolUse: (input) =>
            workiqOriginals?.guard(input.toolName) ??
            getPowerShellHookOutput(input.toolName, input.toolArgs),
    },
});
const session = lifecycle.session;
sessionLog = (message) => session.log(message);
if (initialControl && workiqPolicy !== undefined) {
    publishControlMetadata("native-workiq-session", {
        sessionId: session.sessionId,
        timestamp: Date.now(),
        cwd: process.cwd(),
    });
    await publishWorkiqSessionKnown(initialControl, session.sessionId);
    await waitForWorkiqCapturePolicy(initialControl, session.sessionId);
    const nativeSession = await initializeWorkiqNativeSession(
        initialControl,
        session,
    );
    workiqOriginals = await observeWorkiqToolOriginals(
        initialControl,
        session,
        workiqPolicy,
    ).catch(() => {
        throw new Error(
            "WorkIQ SDK capture initialization blocked; reconcile owned source metadata privately.",
        );
    });
    await publishWorkiqNativeRecord(
        initialControl,
        "native-workiq-session.json",
        {
            ...nativeSession,
            phase: "observing",
            observer: workiqOriginals?.source,
        },
    );
}
if (workiqOriginals) {
    session.on("session.shutdown", () => {
        void workiqOriginals?.finalize().catch(() => {});
    });
    process.once("exit", () => workiqOriginals?.close());
}
process.once("SIGINT", () => void lifecycle.close());
process.once("SIGTERM", () => void lifecycle.close());
process.once("exit", () => lifecycle.closeSync());
if (
    initialControl &&
    !workiqOriginals &&
    controlDiagnosticEnabled(initialControl)
) {
    void runControlDiagnostic(
        session.rpc,
        initialControl,
        session.sessionId,
        (handler) => session.on(handler),
    ).catch((error) =>
        console.error(
            `[control] ${error instanceof Error ? error.message : "Diagnostic failed"}`,
        ),
    );
} else if (initialControl) {
    const registry = await session.rpc.commands.list();
    const status = registry.commands.filter((command) =>
        ["typeagent-status", "typeagent:typeagent-status"].includes(
            command.name,
        ),
    );
    if (status.length !== 1)
        throw new Error(
            "Exactly one registered TypeAgent status command required for control metadata",
        );
    await session.rpc.commands.invoke({
        name: status[0].name,
        input: "--control",
    });
}
sessionSend = async (task) => {
    await session.send({ prompt: task });
};

const capture = new SessionCapture(
    session.sessionId,
    process.cwd(),
    (message) => console.error(message),
    workiqOriginals
        ? {
              connectAgentServer: connectToAgentServer,
              insertToolHistory: async () => {},
              insertTurnHistory: async () => {},
          }
        : undefined,
    (message) => session.log(message),
    async (summary) => {
        if (workiqOriginals && initialControl) {
            const receipt = await workiqOriginals.finalize(summary.traceId);
            await publishWorkiqFinalizedCapture(
                initialControl,
                session.sessionId,
                summary,
                receipt,
            );
        }
    },
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
