// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionEvent } from "@github/copilot-sdk";
import {
    assertControlBinding,
    controlDiagnosticEnabled,
    publishControlMetadata,
} from "../shared/control-metadata.js";
import { connectToMacroOwner } from "../shared/macro-owner.js";
import { getRecipeOwner } from "../shared/plugin-config.js";
import { createPluginLocalRecipes } from "./native-recipe-service.js";
import { createExtensionCommands } from "./commands.js";
import { runControlDiagnostic } from "./control-diagnostic.js";
import { SessionCapture } from "./session-capture.js";
import { joinTypeAgentSession } from "./session-host.js";
import {
    macroAuthorChildAgent,
    createMacroAuthorChildLauncher,
} from "./macro-author-child.js";
import { MacroAuthoringWorker } from "./macro-authoring.js";
import { createMacroTaskReceiptTool } from "./macro-task-receipt.js";
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
const recipeOwner = getRecipeOwner();
if (process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY !== undefined)
    throw new Error(
        "The backend WorkIQ original-retention recording experiment has been removed. Remove TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY and re-record supported tasks through the plugin.",
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
    requestedEnvironmentVariables: [],
    commands,
});
const session = lifecycle.session;
sessionLog = (message) => session.log(message);
const localRecipes =
    recipeOwner === "plugin"
        ? await createPluginLocalRecipes(session, reportCaptureError)
        : undefined;
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
if (initialControl && controlDiagnosticEnabled(initialControl)) {
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

session.on("session.shutdown", () => {
    void close().catch((error) => reportCaptureError(String(error)));
});
if (localRecipes) {
    const launchAuthor = createMacroAuthorChildLauncher(session);
    authoring = new MacroAuthoringWorker({
        cwd: process.cwd(),
        sessionId: session.sessionId,
        connect: async () => localRecipes.authoringConnection,
        launch: launchAuthor,
        report: (message) => {
            void session
                .log(message)
                .catch((error) => reportCaptureError(String(error)));
        },
    });
    const capture = new SessionCapture(
        session.sessionId,
        process.cwd(),
        reportCaptureError,
        {
            connectOwner: async () => localRecipes.connection,
            resolveToolIdentity: localRecipes.resolveToolIdentity,
            normalizeToolResult: localRecipes.normalizeToolResult,
            prepareTrace: localRecipes.prepareTrace,
        },
        (message) => session.log(message),
        async (summary) => {
            if (summary.learningJobId) authoring?.kick();
        },
    );

    await capture.failInterruptedRecording();
    authoring.kick();
    session.on((event: SessionEvent) => {
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
}
