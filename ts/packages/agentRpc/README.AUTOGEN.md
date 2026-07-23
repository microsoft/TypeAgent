<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f1e729fd02edd2c9f86d9010c2a311195ab3ed0fb7c9add4bed334cd18f463e5 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-rpc — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-rpc` package is a TypeScript library that provides remote procedure call (RPC) capabilities for the TypeAgent SDK. It enables communication between distributed components of the TypeAgent system by abstracting the transport layer through an `RpcChannel` interface.

This package is a foundational component of the TypeAgent ecosystem, facilitating modular and distributed architectures. It is widely used across the monorepo by other packages, such as `agent-server-client`, `dispatcher-rpc`, and `agent-api`.

## What it does

The `@typeagent/agent-rpc` package provides tools and abstractions for implementing RPC communication between different parts of the TypeAgent system. Its key features include:

- **Client-side RPC management**: Utilities for initiating and managing RPC operations, including handling abort signals and managing client-specific tasks.
- **Server-side RPC management**: Tools for creating and managing RPC channels for inbound connections.
- **Shared utilities and types**: Common definitions, such as `RpcChannel` and `ChannelProvider`, to ensure consistency across implementations.
- **Rebindable RPC sessions**: Support for creating durable RPC sessions that can rebind to new transport channels upon reconnection, maintaining continuity of state and object identity.

The package is designed to integrate with other TypeAgent components, enabling them to communicate over abstract channels. For example, it is used in `agent-server-client` to manage client-server communication and in `dispatcher-rpc` to facilitate message dispatching.

## Setup

To use the `@typeagent/agent-rpc` package, follow these steps:

1. **Install dependencies**:
   Ensure the following dependencies are installed in your project:

   - `@typeagent/agent-sdk`
   - `@typeagent/common-utils`
   - `debug`

   Use the following command to install the dependencies:

   ```sh
   pnpm install
   ```

2. **Implement rebindable RPC sessions**:
   If you are building a client that requires reconnection capabilities, use the `createRpc` function with the `rebindable` option set to `true`. This allows the RPC session to maintain a stable identity and rebind to a new transport channel upon reconnection. Refer to the hand-written README for an example implementation.

No additional setup steps are required beyond the above.

## Key Files

The `@typeagent/agent-rpc` package is organized into several key files, each responsible for specific functionality:

- [client.ts](./src/client.ts): Implements client-side logic for managing RPC operations. This includes handling abort signals and managing client-specific tasks.
- [common.ts](./src/common.ts): Defines shared types and utilities, such as `RpcChannel` and `ChannelProvider`, which are used across the client and server implementations.
- [rpc.ts](./src/rpc.ts): Contains the core logic for creating and managing RPC instances. The `createRpc` function is a key export, enabling the creation of both rebindable and non-rebindable RPC sessions.
- [server.ts](./src/server.ts): Implements server-side logic for managing RPC operations, including creating and managing RPC channels for server-side use cases.
- [types.ts](./src/types.ts): Provides type definitions used throughout the package, ensuring type safety and consistency. Examples include `RpcInvokeFunctions`, `RpcCallFunctions`, and `AgentContextCallFunctions`.

These files collectively define the core functionality of the package and serve as the primary points of extension and customization.

## How to extend

To extend the `@typeagent/agent-rpc` package, follow these steps:

1. **Identify the area to extend**:

   - For client-side functionality, focus on [client.ts](./src/client.ts).
   - For server-side functionality, work with [server.ts](./src/server.ts).
   - For shared utilities or types, refer to [common.ts](./src/common.ts) or [types.ts](./src/types.ts).
   - For changes to RPC creation and management, modify [rpc.ts](./src/rpc.ts).

2. **Follow existing patterns**:
   Review the existing code to understand the structure and conventions. This will help you maintain consistency with the rest of the package.

3. **Implement your changes**:
   Add new functionality or modify existing features as needed. Ensure that your changes align with the abstractions and interfaces already defined in the package.

4. **Write tests**:
   Add unit tests to validate your changes. Ensure that all existing tests pass and that your modifications do not introduce regressions.

5. **Document your changes**:
   Update any relevant documentation or comments to reflect your modifications.

By following these steps, you can effectively contribute to the `@typeagent/agent-rpc` package while maintaining its design principles and code quality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./client` → [./dist/client.js](./dist/client.js)
- `./channel` → [./dist/common.js](./dist/common.js)
- `./rpc` → [./dist/rpc.js](./dist/rpc.js)
- `./server` → [./dist/server.js](./dist/server.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)

External: `debug`

### Used by

- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../packages/agentServer/protocol/README.md)
- [@typeagent/browser-control-rpc](../../packages/agents/browserControlRpc/README.md)
- [@typeagent/browser-extension](../../packages/agents/browserExtension/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [@typeagent/websocket-utils](../../packages/utils/webSocketUtils/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../packages/agentServer/server/README.md)
- [agent-shell](../../packages/shell/README.md)
- _…and 10 more workspace consumers._

### Files of interest

- [./src/client.ts](./src/client.ts)
- [./src/common.ts](./src/common.ts)
- [./src/rpc.ts](./src/rpc.ts)
- [./src/server.ts](./src/server.ts)
- [./src/tsconfig.json](./src/tsconfig.json)
- [./src/types.ts](./src/types.ts)

---

_Auto-generated against commit `8f591da77983db53fd4a3e0ca12b58d80aaa3628` on `2026-07-22T20:55:48.144Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-rpc docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
