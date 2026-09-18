// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CommandDefinition } from "@github/copilot-sdk";
import {
    getConfigPath,
    getMode,
    readConfig,
    writeConfig,
    type Mode,
} from "../shared/plugin-config.js";
import { connectToAgentServer } from "../shared/typeagent-client.js";

const modes = new Set<Mode>(["direct", "mcp", "dev", "bypass"]);

function statusText(): string {
    const config = readConfig();
    const host = process.env.TYPEAGENT_HOST || "localhost";
    const port = process.env.TYPEAGENT_PORT || "8999";
    return [
        "TypeAgent configuration",
        `Mode: ${getMode()}`,
        `TypeAgent PowerShell: ${(config?.powershell?.enabled ?? true) ? "on" : "off"}`,
        `Server: ws://${host}:${port}`,
        `Config: ${getConfigPath()}`,
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
            description: "Show or set the TypeAgent routing mode",
            handler: async ({ args }) => {
                const value = args.trim().toLowerCase();
                if (!value) {
                    await log(`TypeAgent mode: ${getMode()}`);
                    return;
                }
                if (!modes.has(value as Mode)) {
                    await log("Usage: /typeagent-mode direct|mcp|dev|bypass");
                    return;
                }
                const config = readConfig() ?? { mode: "direct" };
                config.mode = value as Mode;
                writeConfig(config);
                await log(`TypeAgent mode switched to ${value}.`);
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
