<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b9c356365536873ec411f5c5e27a1a60482455b3d46ef8a9e96208f5bdef343a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-protocol — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-protocol` package defines the WebSocket RPC contract between the agentServer and its clients. It provides the foundational types, channel names, and methods required for managing conversations, client connections, and discovery mechanisms within the Type Agent Server ecosystem.

## What it does

This package serves as the protocol layer for communication between the agentServer and its clients. It includes:

- **Channel Definitions**: Fixed and session-namespaced channel names for conversation lifecycle and discovery RPC.
- **Conversation Metadata**: Types and structures for describing conversations, including their lifecycle and participants.
- **RPC Methods**: A set of methods exposed on the `agent-server` channel for managing conversations, such as creating, joining, renaming, and deleting conversations.
- **Client-Type Registry**: Utilities for registering and retrieving client types based on connection IDs, enabling client-specific behavior.
- **Discovery Mechanism**: A read-only RPC channel for external clients to look up the live port of in-process app-agents.

The package is used by various components in the TypeAgent ecosystem, including the `agent-server` itself, client libraries, and extensions like VS Code and browser-based agents.

### Key Features

1. **Channel Names**:

   - `AgentServerChannelName`: Fixed channel for conversation lifecycle RPC.
   - `DiscoveryChannelName`: Fixed channel for read-only port discovery.
   - Session-namespaced channels for dispatcher and client IO communication, constructed using helper functions like `getDispatcherChannelName` and `getClientIOChannelName`.

2. **Conversation Management**:

   - Types like `ConversationInfo` and `JoinConversationResult` describe conversation metadata and results.
   - RPC methods such as `joinConversation`, `createConversation`, `listConversations`, and `deleteConversation` enable full lifecycle management of conversations.

3. **Discovery Channel**:

   - Provides a `lookupPort` method for external clients to discover live ports of app-agents, facilitating dynamic connection management.

4. **Client-Type Registry**:
   - Functions like `registerClientType`, `getClientType`, and `unregisterClient` allow the server to track and manage client types based on their connection IDs.

## Setup

This package does not require any special setup beyond installation. To include it in your project, run:

```sh
pnpm install
```

For more details on usage, refer to the hand-written README.

## Key Files

The package is organized into several key files, each serving a specific purpose:

- **[index.ts](./src/index.ts)**: The main entry point, re-exporting all types, constants, and functions from other files.
- **[protocol.ts](./src/protocol.ts)**: Contains the core protocol definitions, including channel names, conversation types, and RPC methods.
- **[queue.ts](./src/queue.ts)**: Re-exports queue-related types and errors from `@typeagent/dispatcher-types` for convenience.
- **[tsconfig.json](./src/tsconfig.json)**: TypeScript configuration for the package.

### File Responsibilities

1. **[protocol.ts](./src/protocol.ts)**:

   - Defines the fixed and session-namespaced channel names.
   - Provides types like `ConversationInfo`, `JoinConversationResult`, and `DispatcherConnectOptions`.
   - Implements the `AgentServerInvokeFunctions` interface, which includes methods for conversation management and server control.

2. **[queue.ts](./src/queue.ts)**:

   - Re-exports queue-related types and errors, such as `QueueRequestState` and `QueueFullError`, from `@typeagent/dispatcher-types`.

3. **[index.ts](./src/index.ts)**:
   - Serves as the public API surface, re-exporting all relevant types, constants, and functions from `protocol.ts` and `queue.ts`.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Understand the Existing Structure**:

   - Start by reviewing the `protocol.ts` file, which contains the core definitions and RPC methods.
   - Familiarize yourself with the exported types and functions in `index.ts`.

2. **Add New Features**:

   - Define new types or methods in `protocol.ts`. For example, you might add a new RPC method for advanced conversation filtering.
   - If the new feature involves queue management, consider adding relevant types or errors in `queue.ts`.

3. **Export New Additions**:

   - Update `index.ts` to export any new types or methods added to `protocol.ts` or `queue.ts`.

4. **Test Your Changes**:

   - Write unit tests to validate the new functionality. Ensure that all existing tests pass and that the new tests cover edge cases.

5. **Document Your Changes**:
   - Update the hand-written README or other documentation to reflect the new functionality.
   - Ensure that the new types and methods are well-documented with comments in the source code.

By following these steps, you can effectively extend the capabilities of the `@typeagent/agent-server-protocol` package while maintaining consistency with its existing structure and purpose.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-protocol docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
