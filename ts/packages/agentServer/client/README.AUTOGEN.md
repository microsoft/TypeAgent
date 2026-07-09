<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=c442b6548d5e51e2d03a61612a7dcffdacd90ec3e2447d7db1973d987b8bdb82 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-client — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-client` package is a TypeScript library designed to facilitate communication with a running `agentServer`. It provides tools for managing WebSocket connections, handling conversations, and ensuring the availability of the server. This package is a key component of the TypeAgent ecosystem, used by clients such as the Shell, CLI, and other integrations.

## What it does

The `@typeagent/agent-server-client` package provides the following capabilities:

- **Connection Management**: The `connectAgentServer` function establishes WebSocket connections to an `agentServer` and returns an `AgentServerConnection` object. This object allows clients to interact with the server and manage conversations.
- **Conversation Management**: The `AgentServerConnection` object includes methods for creating, listing, renaming, and deleting conversations. It also supports joining and leaving conversations.
- **Server Management**: Functions like `ensureAgentServer` and `isServerRunning` help ensure that the `agentServer` is running, spawn it if necessary, and check its status.
- **Convenience Wrappers**: Functions such as `ensureAndConnectConversation` combine multiple steps (e.g., ensuring the server is running, connecting, and joining a conversation) into a single call for ease of use.
- **Discovery**: The `discovery` module provides tools for locating the dynamically assigned port of an in-process agent, which is particularly useful for external clients like browser extensions or IDE plugins.

These features make the package essential for managing interactions with the `agentServer` and its conversation-based architecture.

## Setup

To use this package, you need to configure the following:

- **Environment Variable**:

  - `TYPEAGENT_TUNNEL_TOKEN`: This token is required for certain server interactions. If the hand-written README provides instructions for obtaining this token, refer to it for guidance. Otherwise, ensure the token is set in your environment or `.env` file.

- **Installation**:
  Install the package and its dependencies using `pnpm`:
  ```bash
  pnpm install
  ```

Ensure that the `TYPEAGENT_TUNNEL_TOKEN` environment variable is correctly set before running any code that interacts with the `agentServer`.

## Key Files

The package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting core functions and types for external use.
- **[agentServerClient.ts](./src/agentServerClient.ts)**: Implements the primary logic for connecting to the `agentServer`, managing conversations, and ensuring the server is running.
- **[discovery.ts](./src/discovery.ts)**: Provides tools for discovering the dynamically assigned port of an in-process agent, which is useful for external clients like browser extensions or IDE plugins.
- **[conversation/index.ts](./src/conversation/index.ts)**: Consolidates shared conversation-lifecycle helpers for clients of the `agentServer`.
- **[conversation/lifecycle.ts](./src/conversation/lifecycle.ts)**: Implements connection-level lifecycle helpers, such as joining or creating conversations safely.
- **[conversation/manage.ts](./src/conversation/manage.ts)**: Implements the `manage-conversation` client-action surface, including subcommands like `new`, `list`, `rename`, and `delete`.
- **[conversation/naming.ts](./src/conversation/naming.ts)**: Provides utilities for handling conversation names, including normalization and uniqueness checks.

### Key Functions and Classes

- **`connectAgentServer(url, onDisconnect?)`**: Establishes a WebSocket connection to the `agentServer` and returns an `AgentServerConnection` object.
- **`AgentServerConnection`**: Provides methods for managing conversations, such as `joinConversation`, `createConversation`, `listConversations`, `renameConversation`, and `deleteConversation`.
- **`ensureAgentServer(port?, hidden?, idleTimeout?)`**: Ensures the `agentServer` is running, spawning it if necessary.
- **`isServerRunning(url)`**: Checks if a server is already listening at the specified WebSocket URL.
- **`stopAgentServer(port?)`**: Sends a shutdown RPC to the running server.
- **`ensureAndConnectConversation(clientIO, port?, options?, onDisconnect?, hidden?, idleTimeout?)`**: Combines server management, connection, and conversation joining into a single call.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Identify the area to extend**:

   - For connection and conversation management, start with [agentServerClient.ts](./src/agentServerClient.ts).
   - For conversation lifecycle logic, explore [conversation/lifecycle.ts](./src/conversation/lifecycle.ts).
   - For discovery-related features, modify [discovery.ts](./src/discovery.ts).

2. **Add or modify functionality**:

   - Implement new methods or enhance existing ones in the relevant file.
   - For example, to add a new conversation management feature, extend the `AgentServerConnection` class in [agentServerClient.ts](./src/agentServerClient.ts).

3. **Update exports**:

   - Ensure that any new functions or types are exported in [index.ts](./src/index.ts) so they are accessible to external clients.

4. **Write tests**:

   - Add tests for your new functionality to ensure it works as expected. Follow the existing test patterns in the repository.

5. **Run tests**:
   - Execute the test suite to verify your changes. Use `pnpm test` or the equivalent command configured in the project.

By following these steps, you can effectively extend the capabilities of the `@typeagent/agent-server-client` package while maintaining consistency with its existing architecture.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- `./conversation` → `./dist/conversation/index.js` _(not found on disk)_
- `./discovery` → `./dist/discovery.js` _(not found on disk)_

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
- [remote-client-example](../../../examples/remoteClient/README.md)
- [studio-service](../../../packages/studio-service/README.md)
- _…and 5 more workspace consumers._

### Files of interest

- [./src/conversation/index.ts](./src/conversation/index.ts)
- [./src/index.ts](./src/index.ts)
- [./src/agentServerClient.ts](./src/agentServerClient.ts)
- [./src/conversation/lifecycle.ts](./src/conversation/lifecycle.ts)
- [./src/conversation/manage.ts](./src/conversation/manage.ts)
- [./src/conversation/naming.ts](./src/conversation/naming.ts)
- [./src/discovery.ts](./src/discovery.ts)
- [./src/tsconfig.json](./src/tsconfig.json)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_TUNNEL_TOKEN`

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-client docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
