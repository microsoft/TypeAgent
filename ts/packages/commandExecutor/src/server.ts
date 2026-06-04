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

console.error("Exit Command Executor Server");
