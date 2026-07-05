<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b9c356365536873ec411f5c5e27a1a60482455b3d46ef8a9e96208f5bdef343a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-protocol — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-protocol` package defines the WebSocket RPC contract between the agentServer and its clients. It provides a shared set of types, channel names, and methods that facilitate communication and interaction within the Type Agent Server ecosystem. This package is a foundational component for managing conversations, client connections, and discovery mechanisms in the system.

## What it does

The primary purpose of this package is to standardize the communication protocol between the agentServer and its clients. It achieves this by defining:

- **Channel Names**: Predefined and dynamically generated channel names for managing conversation lifecycles and client communication.
- **Conversation Types**: Data structures that describe conversations, their metadata, and the results of operations on them.
- **RPC Methods**: A set of methods exposed on the `agent-server` channel to manage conversations, including creating, joining, renaming, and deleting conversations, as well as server shutdown.
- **Client-type Registry**: A mechanism to register and retrieve client types based on their connection IDs, enabling client-specific behavior.
- **Discovery Channel**: A read-only channel for external clients to discover the live port of in-process app-agents.

This package is used by various components in the Type Agent ecosystem, including the `agent-server` itself, client libraries, and extensions for tools like Visual Studio Code.

## Setup

This package does not require any special setup beyond installation. To include it in your project, run:

```sh
pnpm install
```

For more details on usage, refer to the hand-written README.

## Key Files

The package is organized into several key files, each serving a specific purpose:

- **[index.ts](./src/index.ts)**: The main entry point of the package. It re-exports all the key types, constants, and functions defined in other files, making them accessible to consumers of the package.
- **[protocol.ts](./src/protocol.ts)**: The core of the package, containing definitions for channel names, conversation types, and RPC methods. This is the primary file for understanding and extending the protocol.
- **[queue.ts](./src/queue.ts)**: Re-exports queue-related types and errors from the `@typeagent/dispatcher-types` package, providing a unified import point for consumers.
- **[tsconfig.json](./src/tsconfig.json)**: TypeScript configuration file for the package, extending the base configuration of the monorepo.

### Channel Names

The package defines several channel names for communication:

- **`AgentServerChannelName`**: The fixed channel name for conversation lifecycle RPC.
- **`DiscoveryChannelName`**: The fixed channel name for read-only port discovery RPC.
- **`getDispatcherChannelName(conversationId: string)`**: Constructs a session-namespaced channel for dispatcher communication, e.g., `dispatcher:<conversationId>`.
- **`getClientIOChannelName(conversationId: string)`**: Constructs a session-namespaced channel for client IO communication, e.g., `clientio:<conversationId>`.

### Conversation Types

The package provides type definitions for managing conversations:

- **`ConversationInfo`**: Describes a conversation, including fields like `conversationId` (UUID), `name` (human-readable label), `clientCount` (number of connected clients), and `createdAt` (ISO 8601 timestamp).
- **`JoinConversationResult`**: Returned by the `joinConversation` method, containing `connectionId` and `conversationId`.
- **`DispatcherConnectOptions`**: Options for the `joinConversation` method, such as `conversationId`, `clientType`, and `filter`.

### RPC Methods

The `AgentServerInvokeFunctions` interface defines the RPC methods available on the `agent-server` channel:

- **`joinConversation(options?)`**: Joins or auto-creates a conversation, returning a `JoinConversationResult`.
- **`leaveConversation(conversationId)`**: Leaves a conversation and cleans up its channels.
- **`createConversation(name, options?)`**: Creates a new named conversation, returning a `ConversationInfo` object.
- **`listConversations(name?)`**: Lists all conversations, optionally filtered by a name substring.
- **`renameConversation(conversationId, newName, options?)`**: Renames a conversation, with options for handling name collisions.
- **`deleteConversation(conversationId)`**: Deletes a conversation and its associated data.
- **`shutdown()`**: Requests a graceful shutdown of the server.

### Client-type Registry

The package includes a registry for managing client types:

- **`registerClientType(connectionId: string, clientType: string)`**: Registers a client type for a given connection ID.
- **`getClientType(connectionId: string)`**: Retrieves the client type for a specific connection ID.
- **`unregisterClient(connectionId: string)`**: Removes a client from the registry.

### Discovery Channel

The `discovery` channel allows external clients to look up the live port of in-process app-agents. The `DiscoveryInvokeFunctions` interface defines the `lookupPort` method:

- **`lookupPort(param: { agentName: string; role?: string })`**: Returns the live port for a specified `agentName` and optional `role`. If no allocation is found, it returns `null`, signaling clients to retry later.

The `createDiscoveryHandlers` function is provided to create a shared set of handlers for the discovery channel. This function accepts a callback for port lookups, allowing flexibility in how port information is retrieved.

## How to extend

To extend the `@typeagent/agent-server-protocol` package, follow these steps:

1. **Understand the existing structure**: Start by reviewing the [protocol.ts](./src/protocol.ts) file, which contains the core definitions for the package.
2. **Add new types or methods**: If you need to introduce new functionality, define additional types or RPC methods in `protocol.ts`. Ensure that your additions align with the existing structure and naming conventions.
3. **Update exports**: Add your new types or methods to the exports in [index.ts](./src/index.ts) so they are available to consumers of the package.
4. **Test your changes**: Write unit tests to validate your additions. Ensure that all existing tests pass and that your new functionality is thoroughly tested.
5. **Document your changes**: Update the hand-written README or provide additional documentation to describe your changes and how they should be used.

By following these guidelines, you can contribute effectively to the `@typeagent/agent-server-protocol` package while maintaining its consistency and reliability.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)

External: _None at runtime._

### Used by

- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [agent-coda](../../../packages/coda/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [remote-client-example](../../../examples/remoteClient/README.md)
- visualstudio-extension-webview
- [vscode-chat](../../../packages/vscode-chat/README.md)
- [vscode-shell](../../../packages/vscode-shell/README.md)

### Files of interest

`./src/index.ts`, `./src/protocol.ts`, `./src/queue.ts`, …and 1 more under `./src/`.

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-protocol docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
