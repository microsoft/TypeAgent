#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadMemoryServerConfig } from "./config.js";
import { startMemoryServer } from "./server.js";

async function main(): Promise<void> {
    loadMemoryServerConfig(process.argv.slice(2));
    const server = await startMemoryServer();

    const close = async () => {
        await server.close();
        process.exitCode = 0;
    };

    process.once("SIGINT", close);
    process.once("SIGTERM", close);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start agent-memory MCP server: ${message}`);
    process.exitCode = 1;
});
