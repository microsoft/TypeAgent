<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=455a4d8bc227f0ea4aa4ae7d312f3e1548791f29dfc018daa4e8e8d1949be36e -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-server — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-server` package is a TypeScript library that implements a long-running WebSocket server for hosting TypeAgent dispatchers. It provides full conversation management capabilities, enabling communication between clients and agents. The server is designed to handle multiple client connections, manage conversations, and facilitate interaction through a shared dispatcher.

## What it does

The `agent-server` package provides a WebSocket-based server that supports a range of actions for managing conversations and server operations. These actions include:

- **Conversation Management**: Actions such as `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation` allow clients to interact with and manage conversations.
- **Server Control**: Actions like `shutdown` enable graceful server termination, while the `--idle-timeout` flag ensures the server can automatically shut down after a period of inactivity.

The server listens on a configurable WebSocket endpoint and uses a `ConversationManager` to handle conversation-related operations. It also integrates with a `SharedDispatcher` to manage multiple client connections within a single conversation, ensuring proper routing and isolation of client interactions.

Additionally, the server supports advanced features such as idle shutdown, ephemeral conversation cleanup, and integration with Microsoft Dev Tunnels for remote access.

## Setup

To set up the `agent-server`, you need to configure the following environment variables:

- `AGENT_SERVER_PORT`: Specifies the port on which the server will listen for WebSocket connections. The default port is `8999`, but you can override it by setting this variable.
- `TYPEAGENT_USER_NAME`: Defines the username for the TypeAgent user. If not set, the server will fall back to the operating system's username.

You can set these variables in your environment or define them in a `.env` file. For more details on starting the server and configuring it, refer to the hand-written README.

## Key Files

The `agent-server` package is organized into several key files, each responsible for specific functionality:

### [server.ts](./src/server.ts) — WebSocket Listener

This file initializes the WebSocket server and manages incoming connections. It creates a `ConversationManager` instance at startup and uses `createWebSocketChannelServer` to listen for WebSocket connections. The server exposes `AgentServerInvokeFunctions` over the `agent-server` RPC channel, enabling clients to perform actions such as:

- Managing conversations (`joinConversation`, `leaveConversation`, `createConversation`, etc.).
- Shutting down the server gracefully using the `shutdown` action.

### [conversationManager.ts](./src/conversationManager.ts) — Conversation Pool

This file manages a pool of conversations, each represented by a `SharedDispatcher` instance. Key responsibilities include:

- **Persistence**: Stores conversation metadata and data in the local file system.
- **Lazy Initialization**: Creates `SharedDispatcher` instances only when a conversation is accessed for the first time.
- **Default Conversations**: Automatically creates a default conversation if none exists and no `conversationId` is provided.
- **Ephemeral Cleanup**: Deletes conversations with specific prefixes (e.g., `cli-ephemeral-`) during startup to clean up after crashed processes.
- **Idle Shutdown**: Monitors client activity and shuts down the server after a specified period of inactivity when the `--idle-timeout` flag is used.

### [sharedDispatcher.ts](./src/sharedDispatcher.ts) — Routing Layer

This file implements the `SharedDispatcher`, which manages multiple client connections within a single conversation. It ensures that:

- Each client is assigned a unique `connectionId`.
- Client IO methods are routed to the appropriate client based on their `connectionId`.
- Client interactions are isolated while sharing the same dispatcher and conversation context.

The `SharedDispatcher` also supports broadcasting messages to all connected clients, with options for filtering recipients.

### [connectionHandler.ts](./src/connectionHandler.ts) — Connection Management

This file defines the logic for handling individual client connections. It uses a `ChannelProvider` to manage RPC channels for each connection and interacts with the `ConversationManager` to handle conversation-related actions.

### [inProcessAgentServer.ts](./src/inProcessAgentServer.ts) — In-Process Server

This file provides an alternative to the WebSocket server by enabling in-process communication. It creates an `AgentServerConnection` and uses a `ConversationManager` to manage conversations. This is useful for scenarios where the server and client run in the same process.

### [startWithTunnel.ts](./src/startWithTunnel.ts) — Dev Tunnel Integration

This file starts the `agent-server` and sets up a Microsoft Dev Tunnel for remote access. It is primarily used during development to expose the server to external devices.

### [status.ts](./src/status.ts) and [stop.ts](./src/stop.ts) — Server Control Utilities

These files provide command-line utilities for checking the server's status and stopping it. They use the `@typeagent/agent-server-client` package to interact with the server.

## How to extend

To extend the `agent-server` package, you can follow these steps:

1. **Understand the architecture**: Start by reviewing the key files mentioned above to understand how the server, conversation manager, and dispatcher interact.
2. **Add new actions**: To introduce new actions, modify the `server.ts` file to expose additional RPC functions. Implement the corresponding logic in the appropriate files, such as `conversationManager.ts` or `sharedDispatcher.ts`.
3. **Enhance conversation management**: If your use case requires changes to how conversations are created, managed, or persisted, update the `conversationManager.ts` file. For example, you can add new features for conversation metadata or modify the idle timeout behavior.
4. **Extend routing logic**: To customize how client interactions are routed within a conversation, modify the `sharedDispatcher.ts` file. You can add new routing rules or enhance existing ones to support additional use cases.
5. **Test your changes**: Use the provided utilities in `status.ts` and `stop.ts` to test your modifications. Ensure that the server behaves as expected and that new actions or features are functioning correctly.

By following these guidelines, you can effectively extend the `agent-server` package to support additional functionality or integrate with other components in the TypeAgent ecosystem.

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

External: `@azure/identity`, `debug`, `dotenv`, `ws`

### Used by

- [agent-shell](../../../packages/shell/README.md)

### Files of interest

`./src/connectionHandler.ts`, `./src/conversationManager.ts`, `./src/inProcessAgentServer.ts`, …and 7 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AGENT_SERVER_PORT`
- `TYPEAGENT_USER_NAME`

---

_Auto-generated against commit `49b1f98433674dfbd7f9c758b953d8ee762f194d` on `2026-07-02T09:02:27.254Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
