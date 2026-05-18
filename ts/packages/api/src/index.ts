// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import { TypeAgentServer } from "./typeAgentServer.js";
import { loadConfig } from "@typeagent/config";

// Load config from YAML layers + Key Vault (replacing legacy dotenv).
await loadConfig({ keyVault: {}, strict: false });

const typeAgentServer: TypeAgentServer = new TypeAgentServer();
typeAgentServer.start();
