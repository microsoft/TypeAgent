<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=33d1e54f8459a2edfda72d6388dfe6a524a3aa779587a58f6c4f0e5ff7a52adf -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-server — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-server` package is a TypeScript library that provides a long-running WebSocket server for hosting TypeAgent dispatchers. It is responsible for managing conversations, facilitating communication between clients and agents, and handling server lifecycle events such as startup and shutdown.

The server is designed to support multiple clients and conversations simultaneously, with features like conversation persistence, lazy initialization, and idle timeout. It integrates with other components in the TypeAgent ecosystem, such as `@typeagent/agent-rpc`, `@typeagent/dispatcher-rpc`, and `@typeagent/agent-server-protocol`.

## What it does

The `agent-server` package provides the core functionality for managing conversations and facilitating communication between clients and agents. It supports the following key actions:

- **Conversation Management**: Actions such as `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation` allow clients to manage and interact with conversations.
- **Server Control**: Actions like `shutdown` enable graceful server termination, ensuring that resources are properly released.
- **Idle Timeout**: The server can be configured to shut down automatically after a specified period of inactivity using the `--idle-timeout` flag.
- **WebSocket Communication**: The server listens on a WebSocket endpoint, enabling real-time communication between clients and agents.
- **Conversation Persistence**: Conversation metadata and data are stored persistently, allowing for session continuity and recovery.

The server also supports integration with Microsoft Dev Tunnels, enabling remote access to the server from other devices.

## Setup

To set up the `agent-server`, you need to configure the following environment variables:

- `AGENT_SERVER_PORT`: Specifies the port on which the server will listen for WebSocket connections. The default port is `8999`.
- `TYPEAGENT_USER_NAME`: The username for the TypeAgent user. This can be set to override the default username derived from the operating system.
- `XDG_CONFIG_HOME`: Specifies the base directory for configuration files. If not set, the default directory is used.

These variables can be set in your environment or in a `.env` file. For more details on starting the server and configuring it, refer to the hand-written README.

## Key Files

The `agent-server` package is organized into several key files, each responsible for specific functionality:

### [server.ts](./src/server.ts) — WebSocket Listener

This file initializes the WebSocket server and manages incoming connections. It creates a `ConversationManager` instance at startup and uses `createWebSocketChannelServer` to listen for WebSocket connections. It also exposes `AgentServerInvokeFunctions` over the `agent-server` RPC channel, enabling actions such as:

- `joinConversation` and `leaveConversation` for managing client participation.
- `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation` for conversation lifecycle management.
- `shutdown` for gracefully stopping the server.

### [conversationManager.ts](./src/conversationManager.ts) — Conversation Pool

This file manages a pool of `SharedDispatcher` instances, each corresponding to a conversation. Key responsibilities include:

- **Persistence**: Stores conversation metadata and data in the file system under the `~/.typeagent/profiles/dev/conversations/` directory.
- **Lazy Initialization**: Initializes `SharedDispatcher` instances only when a conversation is joined for the first time.
- **Automatic Cleanup**: Deletes ephemeral conversations left over from crashed processes during server startup.
- **Idle Shutdown**: Monitors client activity and shuts down the server after a specified period of inactivity.

### [sharedDispatcher.ts](./src/sharedDispatcher.ts) — Routing Layer

This file manages multiple client connections within a single conversation. It provides a shared dispatcher context and routes client IO methods based on unique connection IDs. Key features include:

- **Connection Management**: Assigns unique `connectionId` values to clients and maintains a routing table for client IO.
- **Routing Logic**: Ensures that client-specific actions, such as `setDisplay` and `askYesNo`, are routed to the appropriate client based on their `connectionId`.
- **Broadcasting**: Supports broadcasting messages to all connected clients, with optional filtering.

### [connectionHandler.ts](./src/connectionHandler.ts) — Connection Management

This file defines the logic for handling individual client connections. It uses the `ChannelProvider` to multiplex RPC channels for each connection and interacts with the `ConversationManager` to manage conversations.

### [copilot/displayLogSynthesis.ts](./src/copilot/displayLogSynthesis.ts) — Display Log Synthesis

This file provides utilities for synthesizing `DisplayLogEntry` streams from Copilot session data. It ensures that imported sessions can be replayed in the conversation UI using the standard display-history path.

### [copilot/mirrorImporter.ts](./src/copilot/mirrorImporter.ts) — Copilot Session Importer

This file handles the import of Copilot sessions into the `agent-server`. It supports filtering sessions by repository, timestamp, and session ID, and ensures that imported sessions are idempotent.

### [inProcessAgentServer.ts](./src/inProcessAgentServer.ts) — In-Process Server

This file provides an in-process implementation of the agent server, allowing it to run within the same process as other components. It is useful for scenarios where a standalone server is not required.

## How to extend

To extend the `agent-server` package, you can follow these steps:

1. **Understand the architecture**: Start by reviewing the key files mentioned above to understand the existing structure and functionality.
2. **Add new actions**: To introduce new actions, modify the `server.ts` file to define the new RPC functions and update the `AgentServerInvokeFunctions` interface in the `@typeagent/agent-server-protocol` package.
3. **Enhance conversation management**: If your changes involve new conversation behaviors, update the `conversationManager.ts` file. For example, you can add new methods for advanced conversation handling or modify the existing logic for persistence and cleanup.
4. **Extend routing logic**: To customize how client connections are managed within a conversation, modify the `sharedDispatcher.ts` file. You can add new routing rules or enhance the existing ones.
5. **Test your changes**: Use the provided utilities in `status.ts` and `stop.ts` to test your modifications. Ensure that the server behaves as expected and that all new functionality is thoroughly tested.

By following these guidelines, you can effectively extend the `agent-server` package to support additional features or integrate with other components in the TypeAgent ecosystem.

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

`./src/connectionHandler.ts`, `./src/conversationManager.ts`, `./src/copilot/displayLogSynthesis.ts`, …and 10 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AGENT_SERVER_PORT`
- `TYPEAGENT_USER_NAME`
- `XDG_CONFIG_HOME`

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
