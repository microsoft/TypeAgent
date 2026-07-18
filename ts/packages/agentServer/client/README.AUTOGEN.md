<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5c99a2d89344c3b0b4474211b3862a2ff4ddc20c529ddd4a18379c5b7ccb6acb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-client — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-client` package is a TypeScript library that provides tools for interacting with a running `agentServer`. It enables clients to manage server connections, handle conversations, and ensure the server's availability. This package is a core component of the TypeAgent ecosystem and is utilized by various clients, including the Shell, CLI, and other integrations.

## What it does

The `@typeagent/agent-server-client` package offers the following key functionalities:

- **Server Connection Management**:

  - The `connectAgentServer` function establishes a WebSocket connection to an `agentServer` and returns an `AgentServerConnection` object. This object provides methods for managing conversations and interacting with the server.
  - The `isServerRunning` function checks if an `agentServer` is already running at a specified WebSocket URL.
  - The `ensureAgentServer` function ensures that the `agentServer` is running, spawning it if necessary.

- **Conversation Management**:

  - The `AgentServerConnection` object includes methods for creating, listing, renaming, and deleting conversations. It also allows clients to join and leave conversations.
  - The `conversation` module provides additional utilities for managing conversation lifecycles, such as finding or creating conversations, switching between conversations, and handling conversation names.

- **Convenience Wrappers**:

  - The `ensureAndConnectConversation` function combines multiple steps into a single operation, including ensuring the server is running, connecting to it, and joining a conversation.

- **Discovery**:
  - The `discovery` module helps external clients locate the dynamically assigned port of an in-process agent, which is useful for browser extensions, IDE plugins, and other external integrations.

These features make the package essential for applications that need to interact with the `agentServer` for conversation and server lifecycle management.

## Setup

To use this package, follow these steps:

1. **Install the package**:
   Use `pnpm` to install the package and its dependencies:

   ```bash
   pnpm install
   ```

2. **Set up environment variables**:

   - `TYPEAGENT_TUNNEL_TOKEN`: This environment variable is required for certain server interactions. Refer to the hand-written README for instructions on obtaining and setting this value.

3. **Configure your environment**:
   Ensure that the `TYPEAGENT_TUNNEL_TOKEN` environment variable is set in your shell or `.env` file before running any code that interacts with the `agentServer`.

## Key Files

The package is organized into several key files, each with specific responsibilities:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting core functions and types for external use.
- **[agentServerClient.ts](./src/agentServerClient.ts)**: Implements the primary logic for connecting to the `agentServer`, managing conversations, and ensuring the server is running.
- **[discovery.ts](./src/discovery.ts)**: Provides functionality for discovering the dynamically assigned port of an in-process agent, useful for external clients like browser extensions or IDE plugins.
- **[conversation/index.ts](./src/conversation/index.ts)**: Aggregates shared conversation-lifecycle helpers for clients of the `agentServer`.
- **[conversation/lifecycle.ts](./src/conversation/lifecycle.ts)**: Contains connection-level lifecycle helpers, such as joining or creating conversations safely.
- **[conversation/manage.ts](./src/conversation/manage.ts)**: Implements the `manage-conversation` client-action surface, including subcommands like `new`, `list`, `rename`, and `delete`.
- **[conversation/naming.ts](./src/conversation/naming.ts)**: Provides utilities for handling conversation names, including normalization and uniqueness checks.

## How to extend

To extend the functionality of the `@typeagent/agent-server-client` package, follow these steps:

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

_Auto-generated against commit `b1b5bcafdde8ba2387d669eec198eb70e8fa5986` on `2026-07-17T23:52:55.795Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-client docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
