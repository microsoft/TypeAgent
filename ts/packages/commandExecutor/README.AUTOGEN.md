<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4855101deb920a4f6c2db045379952465f0ae074e8adcf55321d71526484f765 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# command-executor-mcp — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `command-executor-mcp` package is an MCP (Model Context Protocol) server designed to execute user commands such as playing music, managing lists, and working with calendars. It acts as a bridge between MCP clients (like Claude Code) and the TypeAgent system, accepting natural language commands and forwarding them to the TypeAgent dispatcher for execution.

## What it does

The `command-executor-mcp` package provides several key functionalities:

1. **Natural Language Execution**: Execute commands via natural language using the `execute_command` action. Examples include playing music, managing lists, and scheduling calendar events.
2. **Schema Discovery**: Discover available TypeAgent capabilities using the `discover_schemas` action. This helps identify what actions are available for a given query.
3. **Dynamic Loading**: Load new schemas at runtime using the `load_schema` action, making new agent actions available for direct invocation.
4. **Direct Action Invocation**: Execute structured actions directly using the `typeagent_action` action, providing a fallback mechanism for invoking actions not exposed as individual tools.

## Setup

To configure and run the `command-executor-mcp` server, you need to set the following environment variables:

- `AGENT_SERVER_CONFIG`: Path to the agent server configuration file.
- `AGENT_SERVER_URL`: WebSocket URL of the TypeAgent dispatcher (default: `ws://localhost:8999`).
- `TYPEAGENT_INSTANCE_DIR`: Directory for the TypeAgent instance.

You can set these variables in the `.env` file at the root of the TypeAgent repository. For detailed setup instructions, see the hand-written README.

## Key Files

The internal architecture of the `command-executor-mcp` package is organized as follows:

- **Entry Point**: The main entry point is [./src/index.ts](./src/index.ts), which exports the `CommandServer` and `ExecuteCommandRequest`.
- **Command Server**: The core functionality is implemented in [./src/commandServer.ts](./src/commandServer.ts), which handles command execution and communication with the TypeAgent dispatcher.
- **Configuration**: Configuration management is handled by files in the [./src/config/](./src/config/) directory, including `agentServerConfig.ts` and `configLoader.ts`.
- **Generated Schema Registry**: The package includes a generated schema registry in [./src/generatedSchemaRegistry.json](./src/generatedSchemaRegistry.json), which lists available agents and their actions.

## How to extend

To extend the `command-executor-mcp` package, follow these steps:

1. **Add New Actions**: Implement new actions in the appropriate agent schema file. For example, to add a new calendar action, modify the schema file in the calendar agent directory.
2. **Update Configuration**: Ensure the new actions are registered in the configuration files. Update [agentServerConfig.ts](./src/config/agentServerConfig.ts) and [configLoader.ts](./src/config/configLoader.ts) as needed.
3. **Test Your Changes**: Run tests to verify the new actions work correctly. You can start the MCP server and send test commands through Claude Code or another MCP client.

For a starting point, open [./src/commandServer.ts](./src/commandServer.ts) and review the existing command handling logic. Make sure to follow the established patterns for adding new actions and updating configurations.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

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

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.413Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter command-executor-mcp docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
