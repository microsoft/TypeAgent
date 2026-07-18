<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=932ab325e5be7f17ba37a1de3ae3b7fd209b76a643b1a6a7b42d7bc951f17850 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-server — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-server` package is a TypeScript library that provides a long-running WebSocket server for hosting TypeAgent dispatchers. It manages client connections, facilitates communication between clients and agents, and handles conversation management. The server supports multiple clients and conversations simultaneously, with features such as conversation persistence, idle timeouts, and graceful shutdown.

## What it does

The `agent-server` package is a core component of the TypeAgent ecosystem, enabling communication between clients and agents through a WebSocket server. Its primary responsibilities include:

- **Conversation Management**: The server supports actions such as `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation`. These actions allow clients to manage and interact with conversations.
- **Server Control**: The `shutdown` action provides a mechanism for controlled server termination.
- **Idle Timeout**: The server can be configured to shut down automatically after a specified period of inactivity using the `--idle-timeout` flag.
- **Ephemeral Conversation Cleanup**: On startup, the server removes temporary conversations (e.g., those created by CLI processes) to free up resources.

The server listens on a WebSocket endpoint and processes these actions by interacting with its core components, such as the `ConversationManager` and `SharedDispatcher`. It integrates with other TypeAgent packages, including `@typeagent/agent-server-client` and `@typeagent/agent-server-protocol`, to provide a consistent framework for agent-based communication.

## Setup

To set up the `agent-server`, you need to configure the following environment variables:

- `AGENT_SERVER_PORT`: Specifies the port on which the server listens for WebSocket connections. Defaults to `8999` if not set.
- `SPEECH_SDK_ENDPOINT`: The endpoint for the speech SDK. Refer to the hand-written README for details on obtaining this value.
- `SPEECH_SDK_KEY`: The API key for the speech SDK. Refer to the hand-written README for details on obtaining this value.
- `SPEECH_SDK_REGION`: The region for the speech SDK. Refer to the hand-written README for details on obtaining this value.
- `TYPEAGENT_DEV`: A flag to enable development mode. Set this to `true` for development purposes.
- `TYPEAGENT_USER_NAME`: The username for the TypeAgent user. This can override the default OS user name.
- `XDG_CONFIG_HOME`: Specifies the base directory for configuration files. If not set, the default is typically `~/.config`.

You can set these variables in your environment or define them in a `.env` file in the `ts/` directory. For additional details, refer to the hand-written README.

## Key Files

The `agent-server` package is organized into several key files, each responsible for specific functionality:

### [server.ts](./src/server.ts) — WebSocket Listener

This file initializes the WebSocket server and manages client connections. It performs the following tasks:

1. Creates a `ConversationManager` instance to handle conversation-related operations.
2. Sets up the WebSocket server using `createWebSocketChannelServer`.
3. Exposes RPC functions over the `agent-server` channel, including:
   - `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation` for conversation management.
   - `shutdown` for graceful server termination.

### [conversationManager.ts](./src/conversationManager.ts) — Conversation Pool

This file manages the lifecycle of conversations and their associated dispatchers. Key responsibilities include:

- **Persistence**: Stores conversation metadata and data in the user's configuration directory.
- **Lazy Initialization**: Creates `SharedDispatcher` instances only when a conversation is accessed.
- **Default Conversations**: Automatically creates a default conversation if none exists.
- **Ephemeral Cleanup**: Deletes temporary conversations (e.g., `cli-ephemeral-*`) on server startup.
- **Idle Shutdown**: Monitors client activity and shuts down the server after a period of inactivity if the `--idle-timeout` flag is set.

### [sharedDispatcher.ts](./src/sharedDispatcher.ts) — Routing Layer

This file manages multiple client connections within a single conversation. It provides the following functionality:

- Assigns unique `connectionId`s to clients and maintains a routing table.
- Routes client IO methods (e.g., `setDisplay`, `askYesNo`) to the appropriate client based on their `connectionId`.
- Ensures that each client's interactions are isolated while sharing the same dispatcher and conversation context.

### [connectionHandler.ts](./src/connectionHandler.ts) — Connection Management

This file defines the logic for handling individual client connections. It sets up the necessary RPC channels and integrates with the `ConversationManager` to manage conversations for each connected client.

### [copilot/displayLogSynthesis.ts](./src/copilot/displayLogSynthesis.ts) — Display Log Synthesis

This file synthesizes display logs from Copilot session data, enabling imported sessions to be replayed in the conversation UI. It ensures that the synthesized logs are deterministic and idempotent, allowing for consistent re-imports.

### [copilot/mirrorImporter.ts](./src/copilot/mirrorImporter.ts) — Copilot Session Importer

This file provides functionality to import Copilot sessions into the `agent-server`. It supports filtering sessions by repository, timestamp, and session ID, and integrates with the `ConversationManager` to create or update conversations based on the imported data.

### [inProcessAgentServer.ts](./src/inProcessAgentServer.ts) — In-Process Server

This file provides an in-process implementation of the agent server, allowing it to be embedded within other applications. It includes options for user identity resolution, idle timeout, and shutdown handling.

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

`./src/connectionHandler.ts`, `./src/conversationManager.ts`, `./src/copilot/displayLogSynthesis.ts`, …and 11 more under `./src/`.

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

_Auto-generated against commit `5cbcf613f047f08749d0451296eb1cdc610ae414` on `2026-07-17T18:24:18.404Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
