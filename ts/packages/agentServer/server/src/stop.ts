// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { stopAgentServer } from "@typeagent/agent-server-client";

const portIdx = process.argv.indexOf("--port");
const port = portIdx !== -1 ? parseInt(process.argv[portIdx + 1]) : 8999;

await stopAgentServer(port);
