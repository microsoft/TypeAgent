// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    stopAgentServer,
    AGENT_SERVER_DEFAULT_PORT,
} from "@typeagent/agent-server-client";

const portIdx = process.argv.indexOf("--port");
const port =
    portIdx !== -1
        ? parseInt(process.argv[portIdx + 1])
        : AGENT_SERVER_DEFAULT_PORT;

await stopAgentServer(port);
