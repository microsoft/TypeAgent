// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CommandDefinition } from "@github/copilot-sdk";
import {
    getConfigPath,
    getModeLabel,
    readConfig,
} from "../shared/plugin-config.js";
import {
    getModeDescription,
    handleModeSetting,
} from "../shared/mode-command.js";
import { connectToAgentServer } from "../shared/typeagent-client.js";
import { cancelMacroWork, learningSetting } from "../shared/macro-learning.js";

function statusText(): string {
    const config = readConfig();
    const host = process.env.TYPEAGENT_HOST || "localhost";
    const port = process.env.TYPEAGENT_PORT || "8999";
    return [
        "TypeAgent configuration",
        `Mode: ${getModeLabel()}`,
        `Routing: ${getModeDescription()}`,
        `TypeAgent PowerShell: ${(config?.powershell?.enabled ?? true) ? "on" : "off"}`,
        `Server: ws://${host}:${port}`,
        `Config: ${getConfigPath()}`,
        "Mode settings are shared by sessions using this config.",
    ].join("\n");
}

export function createExtensionCommands(
    log: (message: string) => Promise<void>,
    sendTask?: (task: string) => Promise<void>,
): CommandDefinition[] {
    return [
        {
            name: "typeagent-status",
            description: "Show TypeAgent configuration and connection details",
            handler: async () => log(statusText()),
        },
        {
            name: "typeagent-mode",
            description:
                "Show or set TypeAgent mode: direct, mcp [delegate|mixed], dev, bypass. MCP preserves saved policy; default delegate uses processCommand, mixed prefers TypeAgent discovery/execution for Copilot-selected operations. Native tools are fallback only for capability gaps.",
            handler: async ({ args }) => {
                await log(handleModeSetting(args, "/typeagent-mode"));
            },
        },
        {
            name: "typeagent-macro-learning",
            description:
                "Show or set workspace macro learning: off, prepare, read-only, all",
            handler: async ({ args }) =>
                log(await learningSetting(process.cwd(), args)),
        },
        {
            name: "typeagent-macro-status",
            description: "Show recording and background macro learning status",
            handler: async ({ sessionId }) => {
                const connection = await connectToAgentServer();
                try {
                    const state =
                        await connection.getMacroRecordingState(sessionId);
                    await log(JSON.stringify(state, null, 2));
                } finally {
                    await connection.close();
                }
            },
        },
        {
            name: "typeagent-macro-cancel",
            description:
                "Cancel selected recording or unapproved background preparation",
            handler: async ({ sessionId }) =>
                log(await cancelMacroWork(sessionId)),
        },
        {
            name: "typeagent-macro-record",
            description:
                "Execute and learn a task, or learn the next executed interaction",
            handler: async ({ sessionId, args }) => {
                const task = args.trim();
                if (task && !sendTask) {
                    throw new Error(
                        "Task execution is unavailable in this extension session.",
                    );
                }
                const connection = await connectToAgentServer();
                try {
                    const token = await connection.armMacroRecording({
                        sessionId,
                        cwd: process.cwd(),
                        learning: true,
                    });
                    await log(
                        `Macro learning armed for ${task ? "this task" : "the next interaction"}. Recording token: ${token.id}`,
                    );
                } finally {
                    await connection.close();
                }
                if (task && sendTask) await sendTask(task);
            },
        },
    ];
}
