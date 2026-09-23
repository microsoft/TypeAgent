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
                "Show or set TypeAgent mode: direct, mcp [delegate|mixed], dev, bypass. MCP preserves saved policy; default delegate uses processCommand, mixed enables Copilot-selected discovery/direct routing.",
            handler: async ({ args }) => {
                await log(handleModeSetting(args, "/typeagent-mode"));
            },
        },
        {
            name: "typeagent-macro-record",
            description: "Record the next Copilot interaction as a macro trace",
            handler: async ({ sessionId }) => {
                const connection = await connectToAgentServer();
                try {
                    const token = await connection.armMacroRecording({
                        sessionId,
                    });
                    await log(
                        `Macro recording armed for the next interaction. Recording token: ${token.id}`,
                    );
                } finally {
                    await connection.close();
                }
            },
        },
    ];
}
