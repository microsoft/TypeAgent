// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isServerRunning,
    AGENT_SERVER_DEFAULT_PORT,
} from "@typeagent/agent-server-client";

const portIdx = process.argv.indexOf("--port");
const port =
    portIdx !== -1
        ? parseInt(process.argv[portIdx + 1])
        : AGENT_SERVER_DEFAULT_PORT;

const running = await isServerRunning(`ws://localhost:${port}`);
if (running) {
    console.log(`TypeAgent server is running on port ${port}.`);
} else {
    console.log(`TypeAgent server is not running on port ${port}.`);
}
