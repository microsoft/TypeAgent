// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionEvent } from "@github/copilot-sdk";
import {
    assertControlBinding,
    controlDiagnosticEnabled,
    publishControlMetadata,
} from "../shared/control-metadata.js";
import { connectToAgentServer } from "../shared/typeagent-client.js";
import { connectToMacroOwner } from "../shared/macro-owner.js";
import { getRecipeOwner } from "../shared/plugin-config.js";
import { createPluginLocalRecipes } from "./native-recipe-service.js";
import { createExtensionCommands } from "./commands.js";
import { runControlDiagnostic } from "./control-diagnostic.js";
import { getPowerShellHookOutput } from "./powershell-guidance.js";
import { SessionCapture } from "./session-capture.js";
import { joinTypeAgentSession } from "./session-host.js";
import {
    macroAuthorChildAgent,
    createMacroAuthorChildLauncher,
} from "./macro-author-child.js";
import { MacroAuthoringWorker } from "./macro-authoring.js";
import { createMacroTaskReceiptTool } from "./macro-task-receipt.js";
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
let authoring: MacroAuthoringWorker | undefined;
const reportCaptureError = (message: string) => console.error(message);
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
const recipeOwner = getRecipeOwner();
if (recipeOwner === "plugin" && workiqPolicy !== undefined)
    throw new Error(
        "WorkIQ original-retention recording requires the typeagent recipe owner. Standalone recipes support native and explicitly classified read-only MCP tools.",
    );

const lifecycle = await joinTypeAgentSession({
    customAgents: [macroAuthorChildAgent],
    tools: [
        createMacroTaskReceiptTool(async () => {
            const connection = await connectToMacroOwner(
                process.cwd(),
                session.sessionId,
            );
            try {
                return await connection.getMacroRecordingState(
                    session.sessionId,
                );
            } finally {
                await connection.close();
            }
        }),
    ],
    requestedEnvironmentVariables:
        recipeOwner === "typeagent" ? ["TYPEAGENT_TUNNEL_TOKEN"] : [],
    commands,
    ...(recipeOwner === "typeagent"
        ? {
              hooks: {
                  onPreToolUse: (input) =>
                      workiqOriginals?.guard(input.toolName) ??
                      getPowerShellHookOutput(input.toolName, input.toolArgs),
              },
          }
        : {}),
});
const session = lifecycle.session;
sessionLog = (message) => session.log(message);
const localRecipes =
    recipeOwner === "plugin"
        ? await createPluginLocalRecipes(session, reportCaptureError)
        : undefined;
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
const close = async () => {
    await authoring?.close();
    await localRecipes?.close();
    await lifecycle.close();
};
process.once(
    "SIGINT",
    () => void close().catch((error) => reportCaptureError(String(error))),
);
process.once(
    "SIGTERM",
    () => void close().catch((error) => reportCaptureError(String(error))),
);
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

const launchAuthor = createMacroAuthorChildLauncher(session);
authoring = new MacroAuthoringWorker({
    cwd: process.cwd(),
    sessionId: session.sessionId,
    connect: localRecipes
        ? async () => localRecipes.authoringConnection
        : connectToAgentServer,
    launch: launchAuthor,
    report: (message) => {
        void session
            .log(message)
            .catch((error) => reportCaptureError(String(error)));
    },
});
session.on("session.shutdown", () => {
    void close().catch((error) => reportCaptureError(String(error)));
});
const capture = new SessionCapture(
    session.sessionId,
    process.cwd(),
    reportCaptureError,
    localRecipes
        ? {
              connectAgentServer: async () => localRecipes.connection,
              resolveToolIdentity: localRecipes.resolveToolIdentity,
              normalizeToolResult: localRecipes.normalizeToolResult,
              insertToolHistory: async () => {},
              insertTurnHistory: async () => {},
          }
        : workiqOriginals
          ? {
                connectAgentServer: connectToAgentServer,
                insertToolHistory: async () => {},
                insertTurnHistory: async () => {},
            }
          : undefined,
    (message) => session.log(message),
    async (summary) => {
        if (summary.learningJobId) authoring?.kick();
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
    true,
);

if (recipeOwner !== "off") {
    await capture.failInterruptedRecording();
    authoring.kick();
}
session.on((event: SessionEvent) => {
    if (recipeOwner === "off") return;
    if (launchAuthor.isAuthoringEvent(event)) return;
    if (!event.agentId && event.type === "user.message") authoring?.pause();
    capture.enqueue({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        data: event.data as unknown as Record<string, unknown>,
        ...(event.agentId ? { agentId: event.agentId } : {}),
    });
    if (!event.agentId && event.type === "session.idle") authoring?.kick();
});
