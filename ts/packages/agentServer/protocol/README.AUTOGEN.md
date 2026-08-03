<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ec0830ad5c7adc5d1867cda02358ddc00669f5db2c9553be8b0ba9f6c485dbae -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-protocol — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-protocol` package defines the WebSocket RPC protocol used by the TypeAgent Server and its clients. It provides the foundational types, channel names, and methods required for managing conversations, client connections, and discovery mechanisms within the TypeAgent ecosystem.

This package is a core dependency for various components, including the `agent-server`, `agent-server-client`, and other TypeAgent-based agents and extensions. It ensures consistent communication patterns and data structures across the system.

## What it does

The package standardizes the communication between the agentServer and its clients by defining:

- **Channel Names**: Fixed and session-namespaced channel names for conversation lifecycle and discovery RPC.
- **Conversation Management**: Types and methods for creating, joining, renaming, deleting, and listing conversations.
- **Client-Type Registry**: Utilities for registering, retrieving, and managing client types based on connection IDs.
- **Discovery Mechanism**: A read-only RPC channel for external clients to discover live ports of in-process app-agents.

### Key Features

1. **Channel Definitions**:

   - `AgentServerChannelName`: A fixed channel for conversation lifecycle RPC.
   - `DiscoveryChannelName`: A fixed channel for read-only port discovery.
   - Helper functions like `getDispatcherChannelName` and `getClientIOChannelName` to construct session-namespaced channels.

2. **Conversation Metadata**:

   - Types such as `ConversationInfo` and `JoinConversationResult` describe conversations and their participants.
   - Methods like `joinConversation`, `createConversation`, `renameConversation`, and `deleteConversation` manage conversations.

3. **Discovery Channel**:

   - The `lookupPort` method allows external clients to query the live port of app-agents, facilitating dynamic connection management.

4. **Client-Type Registry**:
   - Functions like `registerClientType`, `getClientType`, and `unregisterClient` enable the server to track and manage client types based on their connection IDs.

## Setup

This package does not require any special setup beyond installation. To include it in your project, run:

```sh
pnpm install
```

For details on usage, refer to the hand-written README.

## Key Files

The package is organized into several key files, each serving a specific purpose in defining and implementing the protocol:

- **[index.ts](./src/index.ts)**: The main entry point, re-exporting all types, constants, and functions from other files.
- **[protocol.ts](./src/protocol.ts)**: Contains the core protocol definitions, including channel names, conversation types, and RPC methods.
- **[queue.ts](./src/queue.ts)**: Re-exports queue-related types and errors from `@typeagent/dispatcher-types` for use by clients.

### File Responsibilities

1. **[protocol.ts](./src/protocol.ts)**:

   - Defines fixed channel names like `AgentServerChannelName` and `DiscoveryChannelName`.
   - Provides helper functions for constructing session-namespaced channel names, such as `getDispatcherChannelName` and `getClientIOChannelName`.
   - Implements types like `ConversationInfo`, `JoinConversationResult`, and `DispatcherConnectOptions`.
   - Defines the `AgentServerInvokeFunctions` interface, which includes methods for conversation management and server control.

2. **[queue.ts](./src/queue.ts)**:

   - Re-exports queue-related types and errors, such as `QueueRequestState` and `QueueFullError`, from `@typeagent/dispatcher-types`.
   - This allows clients to access queue-related functionality without requiring a direct dependency on `@typeagent/dispatcher-types`.

3. **[index.ts](./src/index.ts)**:
   - Serves as the public API surface for the package.
   - Re-exports all relevant types, constants, and functions from `protocol.ts` and `queue.ts`.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Understand the Existing Structure**:

   - Review the `protocol.ts` file for core protocol definitions and RPC methods.
   - Familiarize yourself with the exported types and functions in `index.ts`.

2. **Add New Features**:

   - Define new types or methods in `protocol.ts`. For example, you might add a new RPC method to support additional server-client interactions.
   - If the new feature involves queue management, consider adding relevant types or errors in `queue.ts`.

3. **Export New Additions**:

   - Update `index.ts` to include any new types or methods added to `protocol.ts` or `queue.ts`.

4. **Test Your Changes**:

   - Write unit tests to validate the new functionality. Ensure that all existing tests pass and that the new tests cover edge cases.

5. **Document Your Changes**:
   - Update the hand-written README or other documentation to reflect the new functionality.
   - Add comments to the source code to explain the purpose and usage of the new types and methods.

By following these steps, you can ensure that your contributions align with the existing structure and maintain the quality and consistency of the `@typeagent/agent-server-protocol` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)

External: _None at runtime._

### Used by

- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [@typeagent/browser](../../../packages/agents/browser/README.md)
- [@typeagent/browser-extension](../../../packages/agents/browserExtension/README.md)
- [agent-coda](../../../packages/coda/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [remote-client-example](../../../examples/remoteClient/README.md)
- visualstudio-extension-webview
- [vscode-chat](../../../packages/vscode-chat/README.md)
- [vscode-shell](../../../packages/vscode-shell/README.md)

### Files of interest

`./src/index.ts`, `./src/protocol.ts`, `./src/queue.ts`, …and 1 more under `./src/`.

---

_Auto-generated against commit `5018562335eded84b16dedcbb8e86d59b538a978` on `2026-07-30T06:29:20.146Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-protocol docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
