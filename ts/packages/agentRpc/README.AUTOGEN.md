<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=fc39129747dc152b92661e9af2bd8be339564899c38f1f136f59c0d420a3c98f -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-rpc — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-rpc` package is a TypeScript library that provides remoting capabilities for the TypeAgent SDK. It enables remote procedure calls (RPC) over an abstract `RpcChannel` interface, facilitating communication between distributed components of the TypeAgent system.

This package is a core building block for enabling modular and distributed architectures within the TypeAgent ecosystem. It is widely used across the monorepo by other packages such as `agent-server-client`, `dispatcher-rpc`, and `agent-api`.

## What it does

The primary purpose of this package is to enable remote communication between different components of the TypeAgent system. It provides abstractions and utilities for creating and managing RPC channels, which are used to send and receive messages and invoke remote functions. The key features include:

- **Client-side RPC management**: The client-side implementation allows for initiating and managing RPC operations, including handling abort signals and managing client-specific tasks.
- **Server-side RPC management**: The server-side implementation supports creating and managing RPC channels for inbound connections.
- **Shared utilities and types**: Common types and utilities, such as `RpcChannel` and `ChannelProvider`, are defined to ensure consistency and reusability across the package.
- **Rebindable RPC sessions**: The package supports creating durable RPC sessions that can rebind to new transport channels upon reconnection, ensuring stable identity and continuity of state.

The package is designed to work with other TypeAgent components, enabling them to communicate over abstract channels. For example, it is used in the `agent-server-client` package to manage client-server communication and in `dispatcher-rpc` to facilitate message dispatching.

## Setup

To use the `@typeagent/agent-rpc` package, you need to install its dependencies and ensure your environment is properly configured. Follow these steps:

1. Install the required dependencies:

   - `@typeagent/agent-sdk`
   - `@typeagent/common-utils`
   - `debug`

   Use the following command to install the dependencies:

   ```sh
   pnpm install
   ```

2. If you are implementing a reconnecting client, follow the convention described in the hand-written README to use `createRpc` with the `rebindable` option set to `true`. This ensures that your RPC sessions are durable and can rebind to new transport channels on reconnect.

For additional details, refer to the hand-written README.

## Key Files

The `@typeagent/agent-rpc` package is organized into several key files, each responsible for specific functionality:

- [client.ts](./src/client.ts): Implements the client-side logic for managing RPC operations. This includes utilities for handling abort signals and managing client-specific tasks.
- [common.ts](./src/common.ts): Defines shared types and utilities, such as `RpcChannel` and `ChannelProvider`, which are used across the client and server implementations.
- [rpc.ts](./src/rpc.ts): Provides the core functionality for creating and managing RPC instances. The `createRpc` function is central to this file, enabling the creation of both rebindable and non-rebindable RPC sessions.
- [server.ts](./src/server.ts): Implements the server-side logic for managing RPC operations. It includes utilities for creating and managing RPC channels for server-side use cases.
- [types.ts](./src/types.ts): Contains type definitions used throughout the package, ensuring type safety and consistency. Examples include `RpcInvokeFunctions`, `RpcCallFunctions`, and `AgentContextCallFunctions`.

## How to extend

To extend the functionality of the `@typeagent/agent-rpc` package, follow these steps:

1. **Determine the area to extend**: Identify whether your changes pertain to the client-side, server-side, or shared utilities.
2. **Locate the relevant file**:
   - For client-side extensions, start with [client.ts](./src/client.ts).
   - For server-side extensions, open [server.ts](./src/server.ts).
   - For shared utilities or types, refer to [common.ts](./src/common.ts) or [types.ts](./src/types.ts).
   - For changes to RPC creation and management, work with [rpc.ts](./src/rpc.ts).
3. **Follow existing patterns**: Review the existing code to understand the structure and conventions. This will help you maintain consistency with the rest of the package.
4. **Add new functionality**: Implement your changes, ensuring they align with the existing abstractions and interfaces.
5. **Test your changes**: Write unit tests to validate your new functionality. Ensure that all existing tests pass and that your changes do not introduce regressions.

By adhering to these steps, you can effectively contribute to the `@typeagent/agent-rpc` package while maintaining its design principles and code quality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./client` → `./dist/client.js` _(not found on disk)_
- `./channel` → `./dist/common.js` _(not found on disk)_
- `./rpc` → `./dist/rpc.js` _(not found on disk)_
- `./server` → `./dist/server.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)

External: `debug`

### Used by

- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [@typeagent/websocket-utils](../../packages/utils/webSocketUtils/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../packages/agentServer/server/README.md)
- [agent-shell](../../packages/shell/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- _…and 7 more workspace consumers._

### Files of interest

- [./src/client.ts](./src/client.ts)
- [./src/common.ts](./src/common.ts)
- [./src/rpc.ts](./src/rpc.ts)
- [./src/server.ts](./src/server.ts)
- [./src/tsconfig.json](./src/tsconfig.json)
- [./src/types.ts](./src/types.ts)

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-rpc docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
