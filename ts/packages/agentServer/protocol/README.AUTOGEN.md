<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b9c356365536873ec411f5c5e27a1a60482455b3d46ef8a9e96208f5bdef343a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-protocol — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-protocol` package defines the WebSocket RPC contract between the agentServer and its clients. It provides the foundational types, channel names, and methods required for managing conversations, client connections, and discovery mechanisms within the Type Agent Server ecosystem. This package is a TypeScript library and serves as a shared dependency for various components of the TypeAgent monorepo.

## What it does

The primary purpose of this package is to standardize communication between the agentServer and its clients. It achieves this by defining:

- **Channel Names**: Predefined and dynamically generated channel names for managing conversation lifecycles and client communication.
- **Conversation Types**: Type definitions for conversation metadata, connection results, and options for joining or creating conversations.
- **RPC Methods**: A set of methods exposed on the `agent-server` channel to manage conversations, including creating, joining, renaming, and deleting conversations, as well as server shutdown.
- **Client-type Registry**: A registry to associate client types with connection IDs, enabling client-specific behavior.
- **Discovery Channel**: A read-only channel for external clients to discover the live port of in-process app-agents.

This package is used by multiple components in the TypeAgent ecosystem, including `@typeagent/agent-server-client`, `agent-server`, and various agent implementations like `agent-coda` and `browser-typeagent`.

## Setup

This package does not require any special setup beyond installation. To include it in your project, run:

```sh
pnpm install
```

For more details on usage, refer to the hand-written README.

## Key Files

The package is organized into the following key files:

### [index.ts](./src/index.ts)

This is the main entry point of the package. It re-exports all the key types, constants, and functions defined in other files, making them available for external use. Notable exports include:

- **Channel Names**: `AgentServerChannelName`, `DiscoveryChannelName`, `getDispatcherChannelName`, `getClientIOChannelName`.
- **Conversation Types**: `ConversationInfo`, `JoinConversationResult`, `DispatcherConnectOptions`.
- **RPC Methods**: `AgentServerInvokeFunctions`, including methods like `joinConversation`, `leaveConversation`, `createConversation`, and more.
- **Discovery Handlers**: `createDiscoveryHandlers` for setting up the discovery channel.
- **Client-type Registry Functions**: `registerClientType`, `getClientType`, `unregisterClient`.

### [protocol.ts](./src/protocol.ts)

This file contains the core protocol definitions, including:

- **Channel Names**: Fixed and dynamic channel name definitions for communication.
- **Conversation Types**: Detailed type definitions for conversations, including metadata, connection results, and options.
- **RPC Methods**: Definitions for the methods exposed on the `agent-server` channel, such as `joinConversation`, `createConversation`, and `shutdown`.

### [queue.ts](./src/queue.ts)

This file re-exports queue-related types and errors from the `@typeagent/dispatcher-types` package. This allows clients to access these types directly from `@typeagent/agent-server-protocol` without needing to depend on `@typeagent/dispatcher-types`.

### [tsconfig.json](./src/tsconfig.json)

The TypeScript configuration file for the package. It extends the base TypeScript configuration for the monorepo and specifies the input and output directories for the compiled files.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Start with `protocol.ts`**: This file contains the core protocol definitions. If you need to add new types, channel names, or RPC methods, this is the place to start.

   - For example, to add a new RPC method, define its type in `protocol.ts` and include it in the `AgentServerInvokeFunctions` type.

2. **Update `index.ts`**: After adding new types or methods in `protocol.ts`, ensure they are exported in `index.ts` so they are available to other packages.

3. **Modify the client-type registry if needed**: If your extension involves new client types or changes to how client types are managed, update the registry functions in `protocol.ts`.

4. **Extend the discovery channel**: If your extension requires changes to the discovery mechanism, modify the `createDiscoveryHandlers` function in `protocol.ts`. Ensure that the new functionality is compatible with the existing `PortRegistrar` interface.

5. **Write tests**: Add or update tests to cover your changes. Ensure that all existing tests pass and that your new functionality is thoroughly tested.

6. **Document your changes**: Update the hand-written README and this documentation to reflect your additions. Clearly describe the new functionality and provide examples where applicable.

By following these steps, you can ensure that your extensions are consistent with the existing structure and functionality of the `@typeagent/agent-server-protocol` package.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-protocol docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
