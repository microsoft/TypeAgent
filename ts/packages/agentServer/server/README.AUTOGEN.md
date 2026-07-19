<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3008059e45af46e7278e220bd01bbfd401b6b2acbf4d2359d3a3decc9546617f -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-server — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-server` package is a TypeScript library that implements a long-running WebSocket server for hosting TypeAgent dispatchers. It serves as a central hub for managing client connections, facilitating communication between clients and agents, and orchestrating conversation management. The server is designed to handle multiple clients and conversations simultaneously, with features such as conversation persistence, idle timeouts, and ephemeral conversation cleanup.

## What it does

The `agent-server` provides the following key functionalities:

- **WebSocket Server**: Hosts a WebSocket server that listens for client connections and facilitates communication between clients and agents.
- **Conversation Management**: Supports actions such as `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation`. These actions allow clients to manage and interact with conversations.
- **Server Control**: Includes a `shutdown` action for graceful server termination.
- **Idle Timeout**: Configurable idle timeout to automatically shut down the server after a specified period of inactivity.
- **Ephemeral Conversation Cleanup**: Automatically removes temporary conversations (e.g., those created by CLI processes) during server startup to free up resources.
- **Copilot Session Integration**: Provides tools for importing and replaying GitHub Copilot sessions into the conversation UI.

The server integrates with other TypeAgent packages, such as `@typeagent/agent-server-client` and `@typeagent/agent-server-protocol`, to provide a cohesive framework for agent-based communication.

## Setup

To set up the `agent-server`, you need to configure the following environment variables:

- `AGENT_SERVER_PORT`: Specifies the port on which the server listens for WebSocket connections. Defaults to `8999` if not set.
- `SPEECH_SDK_ENDPOINT`: The endpoint for the speech SDK. Refer to the hand-written README for details on obtaining this value.
- `SPEECH_SDK_KEY`: The API key for the speech SDK. Refer to the hand-written README for details on obtaining this value.
- `SPEECH_SDK_REGION`: The region for the speech SDK. Refer to the hand-written README for details on obtaining this value.
- `TYPEAGENT_DEV`: A flag to enable development mode. Set this to `true` for development purposes.
- `TYPEAGENT_USER_NAME`: The username for the TypeAgent user. This can override the default OS user name.
- `XDG_CONFIG_HOME`: Specifies the base directory for configuration files. If not set, the default is typically `~/.config`.

These variables can be set in your environment or defined in a `.env` file in the `ts/` directory. For further details, refer to the hand-written README.

## Key Files

The `agent-server` package is structured into several key files, each with specific responsibilities:

### [server.ts](./src/server.ts) — WebSocket Listener

- Initializes the WebSocket server using `createWebSocketChannelServer`.
- Creates a `ConversationManager` instance to handle conversation-related operations.
- Exposes RPC functions over the `agent-server` channel, including conversation management actions (`joinConversation`, `leaveConversation`, etc.) and server control (`shutdown`).

### [conversationManager.ts](./src/conversationManager.ts) — Conversation Pool

- Manages the lifecycle of conversations and their associated dispatchers.
- Stores conversation metadata and data in the user's configuration directory.
- Implements lazy initialization for `SharedDispatcher` instances, creating them only when a conversation is accessed.
- Automatically creates a default conversation if none exists.
- Cleans up ephemeral conversations (e.g., `cli-ephemeral-*`) on server startup.
- Monitors client activity and shuts down the server after a period of inactivity if the `--idle-timeout` flag is set.

### [sharedDispatcher.ts](./src/sharedDispatcher.ts) — Routing Layer

- Manages multiple client connections within a single conversation.
- Assigns unique `connectionId`s to clients and maintains a routing table.
- Routes client IO methods (e.g., `setDisplay`, `askYesNo`) to the appropriate client based on their `connectionId`.
- Ensures that each client's interactions are isolated while sharing the same dispatcher and conversation context.

### [connectionHandler.ts](./src/connectionHandler.ts) — Connection Management

- Defines the logic for handling individual client connections.
- Sets up the necessary RPC channels and integrates with the `ConversationManager` to manage conversations for each connected client.

### [copilot/displayLogSynthesis.ts](./src/copilot/displayLogSynthesis.ts) — Display Log Synthesis

- Synthesizes display logs from Copilot session data, enabling imported sessions to be replayed in the conversation UI.
- Ensures that the synthesized logs are deterministic and idempotent, allowing for consistent re-imports.

### [copilot/mirrorImporter.ts](./src/copilot/mirrorImporter.ts) — Copilot Session Importer

- Provides functionality to import Copilot sessions into the `agent-server`.
- Supports filtering sessions by repository, timestamp, and session ID.
- Integrates with the `ConversationManager` to create or update conversations based on the imported data.

### [inProcessAgentServer.ts](./src/inProcessAgentServer.ts) — In-Process Server

- Provides an in-process implementation of the agent server, allowing it to be embedded within other applications.
- Includes options for user identity resolution, idle timeout, and shutdown handling.

## How to extend

To extend the `agent-server` package, follow these steps:

1. **Understand the Core Components**:

   - Start with [server.ts](./src/server.ts) to understand how the WebSocket server is initialized and how RPC functions are exposed.
   - Review [conversationManager.ts](./src/conversationManager.ts) to understand how conversations are managed and persisted.
   - Examine [sharedDispatcher.ts](./src/sharedDispatcher.ts) to see how client connections are routed within a conversation.

2. **Add New RPC Functions**:

   - Define new RPC functions in [connectionHandler.ts](./src/connectionHandler.ts) and expose them over the `agent-server` channel.
   - Update the `AgentServerInvokeFunctions` interface in `@typeagent/agent-server-protocol` to include the new functions.

3. **Modify Conversation Behavior**:

   - Extend or modify the `ConversationManager` in [conversationManager.ts](./src/conversationManager.ts) to add new features or change existing behaviors, such as custom persistence or new conversation types.

4. **Enhance Client Routing**:

   - Update [sharedDispatcher.ts](./src/sharedDispatcher.ts) to implement new routing logic or support additional client IO methods.

5. **Test Your Changes**:
   - Use the provided utilities in `status.ts` and `stop.ts` to control the server during testing.
   - Write unit tests for your changes to ensure they work as expected.

By following these guidelines, you can effectively extend the `agent-server` package to support additional functionality or integrate it with other systems.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/server.js` _(not found on disk)_
- `./in-process` → `./dist/inProcessAgentServer.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../../packages/agentServer/protocol/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../../packages/config/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- [dispatcher-node-providers](../../../packages/dispatcher/nodeProviders/README.md)
- [websocket-channel-server](../../../packages/utils/webSocketChannelServer/README.md)

External: `@azure/identity`, `better-sqlite3`, `debug`, `dotenv`, `ws`

### Used by

- [agent-shell](../../../packages/shell/README.md)

### Files of interest

`./src/connectionHandler.ts`, `./src/conversationManager.ts`, `./src/copilot/displayLogSynthesis.ts`, …and 12 more under `./src/`.

### Environment variables

_7 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AGENT_SERVER_PORT`
- `SPEECH_SDK_ENDPOINT`
- `SPEECH_SDK_KEY`
- `SPEECH_SDK_REGION`
- `TYPEAGENT_DEV`
- `TYPEAGENT_USER_NAME`
- `XDG_CONFIG_HOME`

---

_Auto-generated against commit `66ead8985b850f2775c9b1a96cb7de1d08e2aee1` on `2026-07-18T01:38:20.033Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
