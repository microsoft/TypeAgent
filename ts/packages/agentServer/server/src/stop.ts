// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { stopAgentServer } from "@typeagent/agent-server-client";

// stopAgentServer always targets the configured URL
// (AGENT_SERVER_PORT, default 8999). The --port flag overrides it
// for this process.
const portIdx = process.argv.indexOf("--port");
if (portIdx !== -1) {
    process.env.AGENT_SERVER_PORT = process.argv[portIdx + 1];
}

await stopAgentServer();
