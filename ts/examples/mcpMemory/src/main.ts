// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InteractiveIo,
    CommandHandler,
    addStandardHandlers,
    runConsole,
    CommandMetadata,
    arg,
    parseNamedArguments,
} from "interactive-app";
import { fileURLToPath } from "url";
import { ChalkWriter } from "examples-lib";
import { callPingTool, callTextTool, createNodeClient } from "./mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { RecallRequest, RememberRequest } from "./memoryServer.js";

class McpMemoryWriter extends ChalkWriter {
    constructor() {
        super();
    }
}

type McpMemoryContext = {
    writer: McpMemoryWriter;
};

async function addMcpCommands(
    commandHandlers: Record<string, CommandHandler>,
): Promise<void> {
    const scriptPath = fileURLToPath(new URL("server.js", import.meta.url));

    const context: McpMemoryContext = {
        writer: new McpMemoryWriter(),
    };

    commandHandlers.remember = remember;
    commandHandlers.recall = recall;
    commandHandlers.ping = ping;

    function rememberDef(): CommandMetadata {
        return {
            description: "Add to conversation memory",
            args: {
                memory: arg(
                    "Memories to remember expressed in natural language",
                ),
            },
            options: {
                name: arg("The name of the memory to use", "default"),
            },
        };
    }
    commandHandlers.remember.metadata = rememberDef();
    async function remember(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, rememberDef());
        context.writer.writeLine("Remembering");
        const response = await callTextTool<RememberRequest>(
            createClient,
            "remember",
            {
                memoryName: namedArgs.name,
                memory: namedArgs.memory,
            },
        );
        context.writer.writeLine(response);
    }

    function recallDef(): CommandMetadata {
        return {
            description: "Recall information from conversation memory",
            args: {
                query: arg("Recall with this natural language query"),
            },
            options: {
                name: arg("The name of the memory to use", "default"),
            },
        };
    }
    commandHandlers.recall.metadata = recallDef();
    async function recall(args: string[]) {
        const namedArgs = parseNamedArguments(args, recallDef());
        const response = await callTextTool<RecallRequest>(
            createClient,
            "recall",
            {
                memoryName: namedArgs.name,
                query: namedArgs.query,
            },
        );
        context.writer.writeLine(response);
    }

    commandHandlers.ping.metadata = "Ping the memory server";
    async function ping(args: string[]) {
        const message = new Date().toISOString();
        context.writer.writeLine(`PING ${message}`);
        const response = await callPingTool(createClient, { message });
        context.writer.writeLine(response);
    }

    function createClient(): Promise<Client> {
        return createNodeClient({ scriptPath });
    }

    return;
}

let commandHandlers: Record<string, CommandHandler> = {};
addStandardHandlers(commandHandlers);

function onStart(io: InteractiveIo): void {}

await addMcpCommands(commandHandlers);
await runConsole({
    onStart,
    handlers: commandHandlers,
});
