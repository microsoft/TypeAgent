// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * MCP server entry point for the TypeAgent Copilot CLI plugin.
 *
 * One bundled entry point serves three logical servers, selected by argv:
 * the agent-server tools (default), the read-only workspace tools
 * (`--workspace`), and the macro catalog tools (`--macros`).
 */

import { TypeAgentMcpServer, log } from "./agentServer.js";
import { TypeAgentMacroMcpServer } from "./macroServer.js";
import { selectMcpServer } from "./serverSelector.js";
import { TypeAgentWorkspaceMcpServer } from "./workspaceServer.js";

const serverKind = selectMcpServer(process.argv.slice(2));
const server =
    serverKind === "workspace"
        ? new TypeAgentWorkspaceMcpServer()
        : serverKind === "macros"
          ? new TypeAgentMacroMcpServer()
          : new TypeAgentMcpServer();
server.start().catch((error) => {
    log(`Fatal error: ${error}`);
    process.exit(1);
});
