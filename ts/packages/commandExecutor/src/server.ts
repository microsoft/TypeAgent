// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandServer } from "./commandServer.js";
import { loadConfig } from "@typeagent/config";

// Load config from YAML layers + Key Vault (replacing legacy dotenv).
await loadConfig({ keyVault: {}, strict: false });

// This is a stdio MCP server: stdout is the JSON-RPC channel. All diagnostic
// output must go to stderr or it corrupts the protocol stream.
console.error("Starting Command Executor Server");

const commandServer = new CommandServer();
await commandServer.start();

// The subagent manager tears an instance down by killing this process. Handle
// termination signals so the isolated conversation gets deleted on the way out
// (best-effort; POSIX only — Windows kill is not catchable).
let shuttingDown = false;
const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`Received ${signal}, shutting down Command Executor Server`);
    try {
        await commandServer.close();
    } finally {
        process.exit(0);
    }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.error("Exit Command Executor Server");
