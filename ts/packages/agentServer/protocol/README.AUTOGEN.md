<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b9c356365536873ec411f5c5e27a1a60482455b3d46ef8a9e96208f5bdef343a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-protocol — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-protocol` package defines the WebSocket RPC contract between the agentServer and its clients. It provides the types, channel names, and methods necessary for managing conversations and client connections within the Type Agent Server ecosystem.

## What it does

This package serves as the protocol layer for communication between the agentServer and its clients. It defines the structure and behavior of the interactions, ensuring consistent and predictable communication. Key features include:

- **Channel Names**: Provides fixed and session-specific channel names for managing conversation lifecycles and client communication. For example:

  - `AgentServerChannelName` is the fixed channel name for conversation lifecycle RPC.
  - `DiscoveryChannelName` is the fixed channel name for read-only port discovery RPC.
  - Helper functions like `getDispatcherChannelName(conversationId)` and `getClientIOChannelName(conversationId)` generate session-specific channel names.

- **Conversation Management**: Defines types and methods for creating, joining, renaming, listing, and deleting conversations. For instance:

  - `joinConversation` allows clients to join or auto-create a conversation and returns a `JoinConversationResult`.
  - `createConversation` creates a new named conversation and returns a `ConversationInfo` object.
  - `listConversations` retrieves all conversations, optionally filtered by name.

- **Client-Type Registry**: Maintains a mapping of `connectionId` to `clientType`, enabling the server to adapt its behavior based on the type of client connected. Functions like `registerClientType`, `getClientType`, and `unregisterClient` manage this registry.

- **Discovery Channel**: Provides a mechanism for external clients (e.g., Chrome extensions, VS Code extensions, CLI tools) to discover the live port of any in-process app-agent. The `lookupPort` method on the `discovery` channel allows clients to query the port for a specific agent and role.

This package is used by various components in the Type Agent ecosystem, including `@typeagent/agent-server-client`, `agent-coda`, `agent-server`, and others.

## Setup

No additional setup is required for this package beyond installation. To include it in your project, run:

```sh
pnpm install
```

The package does not require any environment variables or external configuration.

## Key Files

The package is organized into the following key files:

- **[index.ts](./src/index.ts)**: Serves as the main entry point for the package. It re-exports all the key types, constants, and functions defined in other files, such as `protocol.ts` and `queue.ts`.
- **[protocol.ts](./src/protocol.ts)**: Contains the core protocol definitions, including channel names, conversation types, and RPC methods. This is the primary file for understanding and extending the protocol.
- **[queue.ts](./src/queue.ts)**: Re-exports queue-related types and errors from the `@typeagent/dispatcher-types` package, allowing clients to access these definitions from a single location.
- **[tsconfig.json](./src/tsconfig.json)**: The TypeScript configuration file for the package, specifying compiler options and project structure.

## How to extend

To extend the `@typeagent/agent-server-protocol` package, follow these steps:

1. **Understand the existing structure**:

   - Start by reviewing the [protocol.ts](./src/protocol.ts) file, which contains the core definitions for channel names, conversation types, and RPC methods.
   - Familiarize yourself with the exports in [index.ts](./src/index.ts) to understand how the package is structured.

2. **Add new functionality**:

   - To introduce new RPC methods, define them in `protocol.ts` under the appropriate channel (e.g., `agent-server` or `discovery`).
   - If new types or constants are needed, define them in `protocol.ts` and ensure they are exported in `index.ts`.

3. **Update the client-type registry**:

   - If your changes involve new client types or modifications to the client-type registry, update the relevant functions (`registerClientType`, `getClientType`, `unregisterClient`) in `protocol.ts`.

4. **Test your changes**:

   - Write unit tests to validate the new functionality. Ensure that all existing tests pass and that the new tests cover the added features.

5. **Document your changes**:
   - Update the hand-written README or other documentation to reflect the new functionality.
   - Ensure that any new types, methods, or constants are clearly described and include examples where applicable.

By following these steps, you can effectively contribute to and extend the `@typeagent/agent-server-protocol` package.

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-protocol docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
