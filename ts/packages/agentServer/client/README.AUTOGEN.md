<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d431ed8c6e2a113ed693ec920748b03c6b0a6a6278ebe5a58fe1d6e85c4e5102 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-client — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-client` package is a TypeScript library designed to facilitate connections to a running agentServer. It is used by various components such as the Shell and CLI to manage conversations and ensure the server is running.

## What it does

This package provides several key functionalities for interacting with an agentServer:

- **Connection Management**: Establishes WebSocket connections to the agentServer using `connectAgentServer`.
- **Conversation Management**: Supports creating, listing, renaming, and deleting conversations through methods on the `AgentServerConnection` object.
- **Server Management**: Ensures the agentServer is running, spawns it if necessary, and checks its status using functions like `ensureAgentServer` and `isServerRunning`.
- **Convenience Wrappers**: Provides simplified methods to ensure the server is running and connect to conversations in one call, such as `ensureAndConnectConversation`.

## Setup

To use this package, you need to install it along with its dependencies. Ensure you have the following environment variables and prerequisites set up:

- **Environment Variables**: None required specifically for this package.
- **Dependencies**: Install the required dependencies using `pnpm install`. This package depends on other TypeAgent packages such as `@typeagent/agent-rpc`, `@typeagent/agent-server-protocol`, and `@typeagent/dispatcher-rpc`.

For detailed setup instructions, see the hand-written README.

## Key Files

The package is structured into several key files:

- **[index.ts](./src/index.ts)**: Exports the main functions and types used by external clients.
- **[agentServerClient.ts](./src/agentServerClient.ts)**: Contains the core implementation for connecting to the agentServer, managing conversations, and ensuring the server is running.
- **[discovery.ts](./src/discovery.ts)**: Provides functionality for discovering the dynamically-assigned port of an in-process agent.
- **[conversation/index.ts](./src/conversation/index.ts)**: Contains shared conversation-lifecycle helpers for clients of the agent server.
- **[conversation/lifecycle.ts](./src/conversation/lifecycle.ts)**: Implements connection-level lifecycle helpers shared by every client that joins an agent server.
- **[conversation/manage.ts](./src/conversation/manage.ts)**: Implements the dispatcher's `manage-conversation` client-action surface.
- **[conversation/naming.ts](./src/conversation/naming.ts)**: Provides conversation name primitives and utilities.

### Key Functions and Classes

- **`connectAgentServer(url, onDisconnect?)`**: Opens a WebSocket connection to the agentServer and returns an `AgentServerConnection`.
- **`AgentServerConnection`**: Manages conversations with methods like `joinConversation`, `leaveConversation`, `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation`.
- **`ensureAgentServer(port?, hidden?, idleTimeout?)`**: Ensures the agentServer is running, spawning it if needed.
- **`isServerRunning(url)`**: Checks if a server is already listening at the given WebSocket URL.
- **`stopAgentServer(port?)`**: Sends a shutdown RPC to the running server.
- **`ensureAndConnectConversation(clientIO, port?, options?, onDisconnect?, hidden?, idleTimeout?)`**: Ensures the server is running, connects, and joins a conversation in one call.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Open the relevant file**: Depending on what you want to extend, start with either [agentServerClient.ts](./src/agentServerClient.ts) for connection and conversation management or [discovery.ts](./src/discovery.ts) for port discovery.
2. **Add new methods or modify existing ones**: Implement new features or enhance existing functionalities by adding or modifying methods in the appropriate file.
3. **Update exports**: Ensure that any new functions or types are exported in [index.ts](./src/index.ts) for external use.
4. **Write tests**: Add tests for your new functionality to ensure it works as expected. Follow the existing test patterns in the repository.
5. **Run tests**: Execute the test suite to verify your changes. Use `pnpm test` or the equivalent command configured in the project.

By following these steps, you can effectively extend the capabilities of the `@typeagent/agent-server-client` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./conversation` → [./dist/conversation/index.js](./dist/conversation/index.js)
- `./discovery` → [./dist/discovery.js](./dist/discovery.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-server-protocol](../../../packages/agentServer/protocol/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [websocket-channel-server](../../../packages/utils/webSocketChannelServer/README.md)

External: `debug`, `isomorphic-ws`

### Used by

- [@typeagent/copilot-plugin](../../../packages/copilot-plugin/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-coda](../../../packages/coda/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [coder-wrapper](../../../packages/coderWrapper/README.md)
- [command-executor-mcp](../../../packages/commandExecutor/README.md)
- [studio-service](../../../packages/studio-service/README.md)
- tools-scripts
- _…and 4 more workspace consumers._

### Files of interest

- [./src/conversation/index.ts](./src/conversation/index.ts)
- [./src/index.ts](./src/index.ts)
- [./src/agentServerClient.ts](./src/agentServerClient.ts)
- [./src/conversation/lifecycle.ts](./src/conversation/lifecycle.ts)
- [./src/conversation/manage.ts](./src/conversation/manage.ts)
- [./src/conversation/naming.ts](./src/conversation/naming.ts)
- [./src/discovery.ts](./src/discovery.ts)
- [./src/tsconfig.json](./src/tsconfig.json)

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-client docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
