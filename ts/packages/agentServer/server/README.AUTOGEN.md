<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=33d1e54f8459a2edfda72d6388dfe6a524a3aa779587a58f6c4f0e5ff7a52adf -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-server — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-server` package is a TypeScript library that provides a long-running WebSocket server for hosting TypeAgent dispatchers. It manages conversations, facilitates communication between clients and agents, and supports features like conversation persistence, idle timeouts, and graceful shutdown.

## What it does

The `agent-server` package is responsible for managing WebSocket connections and enabling communication between clients and agents. It provides a set of actions for conversation management and server control, including:

- `joinConversation` and `leaveConversation` for managing client participation in conversations.
- `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation` for conversation lifecycle management.
- `shutdown` for gracefully stopping the server.

The server listens on a WebSocket endpoint and uses a `ConversationManager` to handle conversation-related operations. It also includes a `SharedDispatcher` to manage multiple client connections within a single conversation. The server can be configured to shut down after a specified period of inactivity using the `--idle-timeout` flag.

Additionally, the package supports integration with Microsoft Dev Tunnels, allowing the server to be exposed to remote devices for cross-device access.

## Setup

To set up the `agent-server`, ensure the following environment variables are configured:

- `AGENT_SERVER_PORT`: Specifies the port on which the server will listen for WebSocket connections. The default is `8999`.
- `TYPEAGENT_USER_NAME`: The username for the TypeAgent user. If not set, the server will attempt to use the system's username.
- `XDG_CONFIG_HOME`: Specifies the base directory for configuration files. If not set, the default is typically `~/.config`.

You can set these variables in your environment or define them in a `.env` file. For more details on starting the server and configuring it, refer to the hand-written README.

## Key Files

The `agent-server` package is organized into several key files, each responsible for specific functionality:

### [server.ts](./src/server.ts) — WebSocket Listener

This file initializes the WebSocket server and manages incoming connections. It creates a `ConversationManager` instance and uses `createWebSocketChannelServer` to start listening for WebSocket connections. It also exposes the `AgentServerInvokeFunctions` over the `agent-server` RPC channel, enabling actions such as:

- Managing conversations (e.g., `joinConversation`, `createConversation`, `listConversations`).
- Handling server control actions like `shutdown`.

### [conversationManager.ts](./src/conversationManager.ts) — Conversation Pool

This file manages a pool of `SharedDispatcher` instances, each corresponding to a conversation. Key responsibilities include:

- **Persistence**: Stores conversation metadata and data in the file system under the `~/.typeagent/profiles/dev/conversations/` directory.
- **Lazy Initialization**: Creates `SharedDispatcher` instances on demand and tears them down after a period of inactivity.
- **Default Conversations**: Automatically creates a default conversation if none exists.
- **Ephemeral Cleanup**: Removes temporary conversations left over from crashed processes during server startup.
- **Idle Shutdown**: Supports shutting down the server after a specified period of inactivity.

### [sharedDispatcher.ts](./src/sharedDispatcher.ts) — Routing Layer

This file manages multiple client connections within a single conversation. It wraps a dispatcher context and routes client IO methods based on connection IDs. Key features include:

- **Connection Management**: Assigns unique `connectionId`s to clients and maintains a routing table.
- **Client Isolation**: Ensures that each client's display output is isolated while sharing the same dispatcher and conversation context.
- **Routing Logic**: Routes client IO methods (e.g., `setDisplay`, `askYesNo`, `requestChoice`) to the appropriate client based on the `connectionId`.

### [connectionHandler.ts](./src/connectionHandler.ts) — Connection Management

This file defines the logic for handling individual WebSocket connections. It interacts with the `ConversationManager` to manage conversations and uses the `agent-server` RPC channel to expose server functions to connected clients.

### [copilot/displayLogSynthesis.ts](./src/copilot/displayLogSynthesis.ts) — Display Log Synthesis

This file provides utilities for synthesizing display logs from Copilot session data. It converts Copilot session turns into `DisplayLogEntry` streams, enabling imported sessions to render in the conversation UI.

### [copilot/mirrorImporter.ts](./src/copilot/mirrorImporter.ts) — Copilot Session Importer

This file handles the import of Copilot sessions into the conversation manager. It reads session data from a SQLite database and creates corresponding conversations in the `agent-server`.

### [inProcessAgentServer.ts](./src/inProcessAgentServer.ts) — In-Process Server

This file provides an in-process implementation of the agent server, allowing it to run within the same process as the client. It is useful for scenarios where a separate server process is not required.

## How to extend

To extend the `agent-server` package, follow these steps:

1. **Understand the architecture**: Start by reviewing the key files mentioned above to understand how the server, conversation manager, and dispatcher components interact.
2. **Add new actions**: To introduce new server actions, modify the `server.ts` file to expose additional RPC functions. Implement the corresponding logic in the appropriate files, such as `conversationManager.ts` or `sharedDispatcher.ts`.
3. **Enhance conversation management**: If you need to change how conversations are handled, edit `conversationManager.ts`. For example, you can add new persistence mechanisms or modify the behavior of default conversations.
4. **Modify routing logic**: To customize how client IO methods are routed within a conversation, update `sharedDispatcher.ts`. You can add new routing rules or adjust existing ones.
5. **Test your changes**: Use the provided utilities in `status.ts` and `stop.ts` to test your modifications. Ensure that the server behaves as expected and that new features work correctly.

By following these guidelines, you can effectively extend the functionality of the `agent-server` package to meet your specific requirements.

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
