<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4f539b70bf2cc0d73c62ce19b8696a39ddb31cfa2f4a0a580c078b7df86e8811 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-server-client — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-server-client` package is a TypeScript library that provides tools for connecting to and interacting with a running `agentServer`. It is a core component of the TypeAgent ecosystem, enabling clients such as the Shell, CLI, and other integrations to manage conversations and ensure the availability of the agentServer.

## What it does

This package offers a comprehensive set of features for managing connections and interactions with an `agentServer`. Key functionalities include:

- **Connection Management**: The `connectAgentServer` function establishes WebSocket connections to an `agentServer` and provides an `AgentServerConnection` object for further interactions.
- **Conversation Management**: The `AgentServerConnection` object supports operations such as:
  - Joining conversations (`joinConversation`)
  - Leaving conversations (`leaveConversation`)
  - Creating new conversations (`createConversation`)
  - Listing existing conversations (`listConversations`)
  - Renaming conversations (`renameConversation`)
  - Deleting conversations (`deleteConversation`)
- **Server Management**: Functions like `ensureAgentServer` and `isServerRunning` help ensure the `agentServer` is running, spawn it if necessary, and check its status.
- **Convenience Wrappers**: Simplified methods like `ensureAndConnectConversation` combine multiple steps into a single call, allowing you to ensure the server is running, connect to it, and join a conversation in one operation.
- **Port Discovery**: The `discovery` module provides functionality for discovering the dynamically assigned port of an in-process agent.

This package is used by various other components in the TypeAgent ecosystem, including the CLI, Shell, and browser-based clients.

## Setup

To use this package, you need to configure the following:

### Environment Variables

- `TYPEAGENT_TUNNEL_TOKEN`: This token is required for secure communication with the agentServer. Refer to the hand-written README for details on how to obtain and configure this token.

### Installation

Install the package and its dependencies using `pnpm`:

```bash
pnpm install
```

This package depends on the following workspace packages:

- `@typeagent/agent-rpc`
- `@typeagent/agent-server-protocol`
- `@typeagent/dispatcher-rpc`
- `websocket-channel-server`

Additionally, it uses the external libraries `debug` and `isomorphic-ws`.

## Key Files

The package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting core functions and types for external use.
- **[agentServerClient.ts](./src/agentServerClient.ts)**: Implements the primary logic for connecting to the `agentServer`, managing conversations, and ensuring the server is running. This file contains the implementation of key functions like `connectAgentServer`, `ensureAgentServer`, and `stopAgentServer`.
- **[discovery.ts](./src/discovery.ts)**: Provides a discovery client for locating the dynamically assigned port of an in-process agent. This is particularly useful for external clients like browser extensions or plugins.
- **[conversation/index.ts](./src/conversation/index.ts)**: Consolidates shared conversation-lifecycle helpers for clients of the `agentServer`.
- **[conversation/lifecycle.ts](./src/conversation/lifecycle.ts)**: Implements connection-level lifecycle helpers, including utilities for finding or creating conversations and handling race conditions.
- **[conversation/manage.ts](./src/conversation/manage.ts)**: Contains the implementation of the dispatcher's `manage-conversation` client-action surface, including subcommands for creating, listing, renaming, and deleting conversations.
- **[conversation/naming.ts](./src/conversation/naming.ts)**: Provides utilities for handling conversation names, such as normalization, uniqueness checks, and sorting.

## How to extend

To extend the `@typeagent/agent-server-client` package, follow these steps:

1. **Identify the area to extend**:

   - For connection and conversation management, start with [agentServerClient.ts](./src/agentServerClient.ts).
   - For port discovery, refer to [discovery.ts](./src/discovery.ts).
   - For conversation lifecycle or management, explore the files in the [conversation](./src/conversation/) directory.

2. **Add or modify functionality**:

   - Implement new methods or enhance existing ones in the relevant file.
   - For example, to add a new conversation management feature, you might start by modifying [conversation/manage.ts](./src/conversation/manage.ts).

3. **Update exports**:

   - Ensure that any new functions or types are exported in [index.ts](./src/index.ts) so they are accessible to external consumers.

4. **Write tests**:

   - Add tests for your new functionality. Follow the existing patterns in the repository to ensure consistency.

5. **Run tests**:
   - Use the project's test suite to verify your changes. Run `pnpm test` or the equivalent command configured in the project.

By following these steps, you can contribute to the `@typeagent/agent-server-client` package and enhance its capabilities.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-server-client docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
