<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=33d1e54f8459a2edfda72d6388dfe6a524a3aa779587a58f6c4f0e5ff7a52adf -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-server — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-server` package is a TypeScript library that provides a long-running WebSocket server for hosting TypeAgent dispatchers. It is responsible for managing conversations, facilitating communication between clients and agents, and handling server lifecycle events such as startup and shutdown.

## What it does

The `agent-server` package is the backbone of the TypeAgent system, enabling real-time communication between clients and agents. It provides a WebSocket-based server that supports a range of actions for managing conversations and server operations. These actions include:

- **Conversation Management**: Actions such as `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation` allow clients to interact with and manage conversations.
- **Server Control**: Actions like `shutdown` enable graceful termination of the server.
- **Idle Timeout**: The server can be configured to shut down automatically after a specified period of inactivity.
- **Integration with Agent Dispatchers**: The server manages a pool of `SharedDispatcher` instances, which handle multiple client connections within a single conversation context.
- **Persistence and Cleanup**: Conversation metadata and logs are stored persistently, and ephemeral conversations are cleaned up during server startup to ensure efficient resource usage.

The server listens on a WebSocket endpoint (default: `ws://localhost:8999`) and can be started either manually or automatically when clients invoke `ensureAgentServer()`.

## Setup

To set up the `agent-server`, ensure the following environment variables are configured:

- `AGENT_SERVER_PORT`: Specifies the port on which the server listens for WebSocket connections. The default is `8999`.
- `TYPEAGENT_USER_NAME`: The username for the TypeAgent user. This can be set to override the default OS user name.
- `XDG_CONFIG_HOME`: Specifies the base directory for configuration files. If not set, the default is typically `~/.config`.

You can set these variables in your environment or define them in a `.env` file. For additional details, refer to the hand-written README.

## Key Files

The `agent-server` package is organized into several key files, each responsible for specific functionality:

### [server.ts](./src/server.ts) — WebSocket Listener

This file initializes the WebSocket server and manages client connections. It creates a `ConversationManager` at startup and uses `createWebSocketChannelServer` to handle WebSocket connections. The server exposes `AgentServerInvokeFunctions` over the `agent-server` RPC channel, enabling actions such as:

- `joinConversation` and `leaveConversation` for managing client participation.
- `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation` for conversation lifecycle management.
- `shutdown` for gracefully stopping the server.

### [conversationManager.ts](./src/conversationManager.ts) — Conversation Pool

This file manages the lifecycle of conversations and their associated `SharedDispatcher` instances. Key responsibilities include:

- **Persistence**: Stores conversation metadata and logs in the user's configuration directory.
- **Lazy Initialization**: Creates `SharedDispatcher` instances only when a conversation is joined for the first time.
- **Default Conversations**: Automatically creates a default conversation if none exists and no `conversationId` is provided.
- **Ephemeral Cleanup**: Removes temporary conversations left over from previous sessions during server startup.
- **Idle Shutdown**: Monitors client activity and shuts down the server after a specified period of inactivity if the `--idle-timeout` flag is set.

### [sharedDispatcher.ts](./src/sharedDispatcher.ts) — Routing Layer

This file manages multiple client connections within a single conversation. It wraps a dispatcher context and routes client IO methods based on connection IDs. Key features include:

- **Connection Management**: Assigns unique `connectionId` values to clients and maintains a routing table for client IO.
- **Routing Logic**: Ensures that client-specific actions, such as `setDisplay` and `askYesNo`, are routed to the appropriate client.
- **Broadcasting**: Supports broadcasting messages to all connected clients, with optional filtering for targeted delivery.

### [connectionHandler.ts](./src/connectionHandler.ts) — Connection Management

This file defines the logic for handling individual client connections. It integrates with the `ConversationManager` to manage conversations and uses the `agent-server` RPC channel to expose server functions to connected clients.

### [copilot/displayLogSynthesis.ts](./src/copilot/displayLogSynthesis.ts) — Display Log Synthesis

This file provides utilities for generating `DisplayLogEntry` streams from Copilot session data. It ensures that imported sessions can be replayed in the conversation UI by synthesizing deterministic log entries.

### [copilot/mirrorImporter.ts](./src/copilot/mirrorImporter.ts) — Copilot Session Importer

This file handles the import of Copilot sessions into the `agent-server`. It reads session data from a SQLite database and converts it into a format compatible with the `agent-server`'s conversation system.

### [inProcessAgentServer.ts](./src/inProcessAgentServer.ts) — In-Process Server

This file provides an in-process implementation of the agent server, allowing it to run within the same process as the client. It is useful for scenarios where low-latency communication is required.

## How to extend

To extend the `agent-server` package, follow these guidelines:

1. **Understand the architecture**: Start by reviewing the key files mentioned above to understand the responsibilities of each component.
2. **Add new actions**: To introduce new server actions, modify [server.ts](./src/server.ts) to expose the new functionality over the `agent-server` RPC channel. Implement the corresponding logic in the appropriate file, such as [conversationManager.ts](./src/conversationManager.ts) or [sharedDispatcher.ts](./src/sharedDispatcher.ts).
3. **Enhance conversation management**: If your changes involve new conversation behaviors, update [conversationManager.ts](./src/conversationManager.ts). For example, you can add new persistence mechanisms or modify the logic for handling idle timeouts.
4. **Extend routing logic**: To customize how client IO is routed within a conversation, modify [sharedDispatcher.ts](./src/sharedDispatcher.ts). You can add new routing rules or adjust existing ones to meet your requirements.
5. **Test your changes**: Use the provided utilities in [status.ts](./src/status.ts) and [stop.ts](./src/stop.ts) to test your modifications. Ensure that all new functionality works as expected and does not introduce regressions.

By following these steps, you can effectively extend the `agent-server` package to support additional features or integrate with other components in the TypeAgent ecosystem.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
