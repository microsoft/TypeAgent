<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=391a851b92c23c56cf489f8f3ed1c0995284c1961bd8e10055f3d398e70e7e40 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-server â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The `agent-server` package is a TypeScript library that provides a long-running WebSocket server for hosting TypeAgent dispatchers with full conversation management capabilities. It listens for connections, manages conversations, and facilitates communication between clients and agents.

## What it does

The `agent-server` package accepts several actions related to conversation management and server control. These actions include `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, `deleteConversation`, and `shutdown`. The server listens on a WebSocket endpoint and handles these actions by interacting with the conversation manager and shared dispatcher components. It also supports graceful shutdown and idle timeout features.

## Setup

To set up the `agent-server`, you need to configure the following environment variables:

- `AGENT_SERVER_PORT`: The port on which the server will listen for WebSocket connections.
- `TYPEAGENT_USER_NAME`: The username for the TypeAgent user.

Ensure these variables are set in your environment or in a `.env` file. For detailed setup instructions, see the hand-written README.

## Key Files
The `agent-server` package is structured around several key components:

### `server.ts` â€” WebSocket listener

The `server.ts` file is responsible for setting up the WebSocket server and managing connections. It creates a `ConversationManager` at startup and calls `createWebSocketChannelServer` to accept connections. For each connection, it exposes `AgentServerInvokeFunctions` over the `agent-server` RPC channel, handling actions such as joining and leaving conversations, creating and listing conversations, and shutting down the server.

### `conversationManager.ts` â€” Conversation pool

The `conversationManager.ts` file maintains a pool of per-conversation `SharedDispatcher` instances. It handles persistence of conversation metadata, lazy initialization of dispatchers, automatic creation of default conversations, and cleanup of ephemeral conversations. It also supports idle shutdown based on the `--idle-timeout` flag.

### `sharedDispatcher.ts` â€” Routing layer

The `sharedDispatcher.ts` file manages multiple client connections within a single conversation. It wraps a dispatcher context and routes client IO methods based on connection IDs. This ensures that each client's display output is isolated while sharing the same dispatcher and conversation context.

### `status.ts` and `stop.ts` â€” Server control

The `status.ts` and `stop.ts` files provide utilities for checking the server status and stopping the server, respectively. They use the `@typeagent/agent-server-client` package to interact with the server.

## How to extend

To extend the `agent-server` package, follow these steps:

1. **Start with `server.ts`**: This file sets up the WebSocket server and manages connections. You can add new RPC functions or modify existing ones to handle additional actions.
2. **Modify `conversationManager.ts`**: If you need to change how conversations are managed, this is the file to edit. You can add new behaviors or modify existing ones related to conversation persistence, initialization, and cleanup.
3. **Update `sharedDispatcher.ts`**: To change how client connections are routed within a conversation, modify this file. You can add new routing logic or adjust the existing methods for handling client IO.
4. **Test your changes**: Ensure that your modifications are working correctly by running the server and testing the new or modified actions. You can use the provided `status.ts` and `stop.ts` utilities to control the server during testing.

By following these steps, you can extend the functionality of the `agent-server` package to meet your specific needs.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default â†’ [./dist/server.js](./dist/server.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../../packages/agentServer/protocol/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- [dispatcher-node-providers](../../../packages/dispatcher/nodeProviders/README.md)
- [websocket-channel-server](../../../packages/utils/webSocketChannelServer/README.md)

External: `@azure/identity`, `debug`, `dotenv`, `ws`

### Files of interest

`./src/conversationManager.ts`, `./src/server.ts`, `./src/sharedDispatcher.ts`, â€¦and 3 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AGENT_SERVER_PORT`
- `TYPEAGENT_USER_NAME`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
