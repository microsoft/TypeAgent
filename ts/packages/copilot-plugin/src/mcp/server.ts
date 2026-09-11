// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeAgentMcpServer } from "./agentServer.js";
import { TypeAgentMacroMcpServer } from "./macroServer.js";
import { TypeAgentWorkspaceMcpServer } from "./workspaceServer.js";
import { selectMcpServer } from "./serverSelector.js";

const kind = selectMcpServer(process.argv.slice(2));
const server =
    kind === "workspace"
        ? new TypeAgentWorkspaceMcpServer()
        : kind === "macros"
          ? new TypeAgentMacroMcpServer()
          : new TypeAgentMcpServer();

if (server instanceof TypeAgentMcpServer) {
    // Stdio has no intrinsic Copilot session identity. This process retains one
    // private structured owner until shutdown, without cancelling pending work.
    process.once("SIGINT", () => void server.close());
    process.once("SIGTERM", () => void server.close());
    process.stdin.once("end", () => void server.close());
}
server.start().catch(() => {
    console.error("Unable to start the TypeAgent MCP server.");
    process.exitCode = 1;
});
