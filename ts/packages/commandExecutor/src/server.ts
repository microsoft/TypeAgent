// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandServer } from "./commandServer.js";
import { loadConfig } from "@typeagent/config";

// Load config from YAML layers + Key Vault (replacing legacy dotenv).
await loadConfig({ keyVault: {}, strict: false });

console.log("Starting Command Executor Server");

const commandServer = new CommandServer();
await commandServer.start();

console.log("Exit Command Executor Server");
