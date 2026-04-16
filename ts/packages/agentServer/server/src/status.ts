// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isServerRunning } from "@typeagent/agent-server-client";

const portIdx = process.argv.indexOf("--port");
const port = portIdx !== -1 ? parseInt(process.argv[portIdx + 1]) : 8999;

const running = await isServerRunning(`ws://localhost:${port}`);
if (running) {
    console.log(`TypeAgent server is running on port ${port}.`);
} else {
    console.log(`TypeAgent server is not running on port ${port}.`);
}
