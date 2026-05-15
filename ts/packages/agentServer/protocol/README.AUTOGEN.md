<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5d84b3f84b8fa8542823bd960ab4cc30c2e1e72fd79d42793af4fa83651aecc9 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-protocol — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-protocol` package defines the WebSocket RPC contract between agentServer clients and the server. It provides the necessary types, channel names, and methods for managing conversations and client connections within the Type Agent Server ecosystem.

## What it does

This package primarily handles the protocol definitions for communication between the agentServer and its clients. It includes:

- **Channel Names**: Fixed and session-namespaced channels for conversation lifecycle RPC.
- **Conversation Types**: Definitions for conversation metadata and results.
- **RPC Methods**: Methods exposed on the `agent-server` channel for managing conversations.
- **Client-type Registry**: Functions for registering and retrieving client types based on connection IDs.

The package exports several key types and functions, such as `AgentServerChannelName`, `getDispatcherChannelName`, `getClientIOChannelName`, `ConversationInfo`, `JoinConversationResult`, `DispatcherConnectOptions`, and various RPC methods like `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, `deleteConversation`, and `shutdown`.

## Setup

No additional setup is required beyond installing the package. Simply run:

```sh
pnpm install
```

## Key Files

The package is structured as follows:

- **[index.ts](./src/index.ts)**: This file exports all the necessary types and functions from `protocol.ts`.
- **[protocol.ts](./src/protocol.ts)**: Contains the definitions for types, channel names, and RPC methods.
- **[tsconfig.json](./src/tsconfig.json)**: TypeScript configuration file for the package.

### Channel Names

- **AgentServerChannelName**: The fixed channel name for conversation lifecycle RPC.
- **getDispatcherChannelName(conversationId: string)**: Constructs session-namespaced channels for dispatcher communication.
- **getClientIOChannelName(conversationId: string)**: Constructs session-namespaced channels for client IO communication.

### Conversation Types

- **ConversationInfo**: Describes a conversation with fields like `conversationId`, `name`, `clientCount`, and `createdAt`.
- **JoinConversationResult**: Returned by `joinConversation`, includes `connectionId` and `conversationId`.
- **DispatcherConnectOptions**: Options passed to `joinConversation`, including `conversationId`, `clientType`, and `filter`.

### RPC Methods

- **AgentServerInvokeFunctions**: Methods exposed on the `agent-server` channel, including:
  - `joinConversation(options?)`
  - `leaveConversation(conversationId)`
  - `createConversation(name)`
  - `listConversations(name?)`
  - `renameConversation(conversationId, newName)`
  - `deleteConversation(conversationId)`
  - `shutdown()`

### Client-type Registry

- **registerClientType(connectionId: string, clientType: string)**: Registers a client type based on connection ID.
- **getClientType(connectionId: string)**: Retrieves the client type for a given connection ID.
- **unregisterClient(connectionId: string)**: Unregisters a client based on connection ID.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Open `protocol.ts`**: This file contains the core definitions and is the starting point for any modifications or additions.
2. **Add new types or methods**: Define new types or RPC methods as needed. Ensure they are well-documented and follow the existing structure.
3. **Export new additions**: Update `index.ts` to export any new types or methods added to `protocol.ts`.
4. **Test your changes**: Write tests to validate the new functionality. Ensure that all existing tests pass and cover the new additions.

By following these steps, you can effectively extend the capabilities of the `@typeagent/agent-server-protocol` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)

External: _None at runtime._

### Used by

- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- visualstudio-extension-webview
- [vscode-shell](../../../packages/vscode-shell/README.md)

### Files of interest

`./src/index.ts`, `./src/protocol.ts`, `./src/tsconfig.json`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.407Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-protocol docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
