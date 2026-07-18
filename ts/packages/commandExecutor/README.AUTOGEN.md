<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=fdbcafa4a129d9b3dc2d53d6f9d26e7f96b7cec10aba774e0d7917ad06592f47 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# command-executor-mcp — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `command-executor-mcp` package is an MCP (Model Context Protocol) server designed to execute user commands such as playing music, managing lists, and working with calendars. It acts as an intermediary between MCP clients (e.g., Claude Code) and the TypeAgent system, translating natural language commands into structured actions that the TypeAgent dispatcher can process.

## What it does

The `command-executor-mcp` package provides the following key functionalities:

1. **Natural Language Command Execution**: The `execute_command` action processes user commands like "play Bohemian Rhapsody by Queen" or "add milk to my shopping list" and forwards them to the TypeAgent dispatcher for execution.
2. **Schema Discovery**: The `discover_schemas` action allows clients to query the available capabilities of the TypeAgent system, such as weather information, email handling, or calendar management.
3. **Dynamic Schema Loading**: Using the `load_schema` action, new schemas can be dynamically loaded at runtime, enabling the server to register and expose new agent actions without requiring a restart.
4. **Direct Action Invocation**: The `typeagent_action` action provides a fallback mechanism for invoking structured actions that are not exposed as individual tools.
5. **Debugging and Connectivity**: The `ping` action is available for testing server connectivity and debugging purposes.

The server connects to the TypeAgent dispatcher via WebSocket and includes automatic reconnection capabilities, ensuring it remains operational even if the dispatcher becomes temporarily unavailable.

## Setup

To configure and run the `command-executor-mcp` server, you need to set the following environment variables:

- `AGENT_SERVER_CONFIG`: Path to the agent server configuration file. This file defines settings such as grammar systems and cache options.
- `AGENT_SERVER_URL`: WebSocket URL of the TypeAgent dispatcher. Defaults to `ws://localhost:8999` if not explicitly set.
- `TYPEAGENT_INSTANCE_DIR`: Directory for the TypeAgent instance, used to locate configuration files and other resources.

These variables can be set in a `.env` file at the root of the TypeAgent repository. For detailed instructions on obtaining and setting these values, refer to the hand-written README.

### Prerequisites

1. **Build the Package**: Before running the server, ensure the package is built:

   ```bash
   pnpm run build
   ```

2. **Start the TypeAgent Server**: The MCP server connects to the TypeAgent dispatcher, which must be running. Start the dispatcher with:

   ```bash
   pnpm run start:agent-server
   ```

3. **Configure MCP Clients**: For MCP clients like Claude Code, add the server configuration to the `.mcp.json` file in the repository root:

   ```json
   {
     "mcpServers": {
       "command-executor": {
         "command": "node",
         "args": ["packages/commandExecutor/dist/server.js"]
       }
     }
   }
   ```

4. **Restart the MCP Client**: Restart Claude Code or your MCP client to load the new configuration.

## Key Files

The `command-executor-mcp` package is organized into several key files and directories:

- **[./src/index.ts](./src/index.ts)**: The main entry point, exporting the `CommandServer` and `ExecuteCommandRequest` classes.
- **[./src/commandServer.ts](./src/commandServer.ts)**: Implements the core server logic, including handling MCP actions and communicating with the TypeAgent dispatcher.
- **[./src/config/](./src/config/)**: Contains configuration-related files:
  - **[agentServerConfig.ts](./src/config/agentServerConfig.ts)**: Defines the structure and defaults for the agent server configuration.
  - **[configLoader.ts](./src/config/configLoader.ts)**: Handles loading configuration files from various locations, including environment variables and the TypeAgent instance directory.
- **[./src/generatedSchemaRegistry.json](./src/generatedSchemaRegistry.json)**: A registry of available schemas and their actions, used for schema discovery and dynamic loading.
- **[./src/server.ts](./src/server.ts)**: The entry point for starting the MCP server, initializing the configuration and launching the `CommandServer`.

## How to extend

To extend the `command-executor-mcp` package, follow these steps:

1. **Add New Actions**:

   - Identify the agent schema where the new action belongs (e.g., calendar, music, or lists).
   - Modify the corresponding schema file in the agent's directory to define the new action.

2. **Update Configuration**:

   - Ensure the new action is registered in the configuration files. Update [agentServerConfig.ts](./src/config/agentServerConfig.ts) and [configLoader.ts](./src/config/configLoader.ts) as needed.

3. **Modify the Command Server**:

   - Open [commandServer.ts](./src/commandServer.ts) and add logic to handle the new action. Follow the existing patterns for processing actions and forwarding them to the TypeAgent dispatcher.

4. **Test Your Changes**:

   - Start the MCP server and send test commands through an MCP client like Claude Code.
   - Verify that the new action is executed correctly and returns the expected results.

5. **Update the Schema Registry**:

   - If the new action introduces a new schema, update [generatedSchemaRegistry.json](./src/generatedSchemaRegistry.json) to include the schema and its actions.

6. **Write Tests**:
   - Add unit tests for the new action to ensure its correctness and prevent regressions. Use the existing test suite as a reference.

By following these steps, you can extend the functionality of the `command-executor-mcp` package to support additional commands and capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- weather-agent

External: `@modelcontextprotocol/sdk`, `dotenv`, `html-to-text`, `isomorphic-ws`, `zod`

### Files of interest

`./src/config/index.ts`, `./src/index.ts`, `./src/commandServer.ts`, …and 5 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AGENT_SERVER_CONFIG`
- `AGENT_SERVER_URL`
- `TYPEAGENT_INSTANCE_DIR`

---

_Auto-generated against commit `5cbcf613f047f08749d0451296eb1cdc610ae414` on `2026-07-17T18:24:18.404Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter command-executor-mcp docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
