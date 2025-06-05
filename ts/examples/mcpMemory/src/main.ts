// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InteractiveIo,
    CommandHandler,
    addStandardHandlers,
    runConsole,
} from "interactive-app";
import { MemoryClient } from "./memoryClient.js";
import { fileURLToPath } from "url";
import { ChalkWriter } from "examples-lib";
import { callPingTool, createNodeClient } from "./mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

class McpMemoryWriter extends ChalkWriter {
    constructor() {
        super();
    }
}

type McpMemoryContext = {
    memoryClient: MemoryClient;
    writer: McpMemoryWriter;
};

async function addMcpCommands(
    commandHandlers: Record<string, CommandHandler>,
): Promise<void> {
    const scriptPath = fileURLToPath(new URL("server.js", import.meta.url));

    const context: McpMemoryContext = {
        memoryClient: new MemoryClient(createClient),
        writer: new McpMemoryWriter(),
    };

    commandHandlers.ping = ping;
    commandHandlers.answer = answer;

    async function ping(args: string[]) {
        const message = new Date().toISOString();
        context.writer.writeLine(`PING ${message}`);
        const response = await callPingTool(createClient, { message });
        context.writer.writeLine(response);
    }

    async function answer(args: string[]) {
        const response = await context.memoryClient.getAnswer("books", args[0]);
        context.writer.writeLine(response);
    }
    return;

    function createClient(): Promise<Client> {
        return createNodeClient({ scriptPath });
    }
}

let commandHandlers: Record<string, CommandHandler> = {};
addStandardHandlers(commandHandlers);

function onStart(io: InteractiveIo): void {}

await addMcpCommands(commandHandlers);
await runConsole({
    onStart,
    handlers: commandHandlers,
});
