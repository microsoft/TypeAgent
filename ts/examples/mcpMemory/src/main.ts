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
import { createNodeClient } from "./mcp.js";

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
        memoryClient: new MemoryClient(() => createNodeClient({ scriptPath })),
        writer: new McpMemoryWriter(),
    };

    commandHandlers.ping = ping;

    async function ping(args: string[]) {
        const response = await context.memoryClient.ping();
        context.writer.writeLine(response);
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
