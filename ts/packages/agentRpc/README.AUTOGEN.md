<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=2ee08938accccc389ca2e7d56635521bb40b471af01e64aef09cc0bcf280c87a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-rpc — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-rpc` package is a remoting library for the TypeAgent SDK. It provides the necessary infrastructure to support remote procedure calls (RPC) over abstract channels, enabling communication between different parts of the TypeAgent system.

## What it does

This package facilitates the remoting of TypeAgent SDK interfaces via an abstract `RpcChannel` interface. It provides mechanisms to create and manage RPC channels, handle messages, and invoke remote functions. The primary components include:

- **Client**: Manages the client-side RPC operations.
- **Server**: Manages the server-side RPC operations.
- **Common**: Defines shared types and utilities for RPC channels.
- **RPC**: Contains functions to create and manage RPC instances.

The package is used by various other packages within the TypeAgent monorepo, such as `agent-server-client`, `dispatcher-rpc`, `agent-api`, and more. It enables these packages to communicate with each other over RPC channels, facilitating a modular and distributed architecture.

## Setup

To set up the `@typeagent/agent-rpc` package, ensure you have the following dependencies installed:

- `@typeagent/agent-sdk`
- `@typeagent/common-utils`
- `debug`

You can install the necessary dependencies using `pnpm`:

```sh
pnpm install
```

For detailed setup instructions, refer to the hand-written README.

## Key Files

The package is structured into several key files, each responsible for different aspects of the RPC functionality:

- [client.ts](./src/client.ts): Contains the client-side implementation for managing RPC operations. It includes functions to race promises against abort signals and utilities for handling client-specific RPC tasks.
- [common.ts](./src/common.ts): Defines shared types and utilities for RPC channels, including `RpcChannel` and `ChannelProvider`. It provides the foundational types and interfaces that are used across both client and server implementations.
- [rpc.ts](./src/rpc.ts): Provides functions to create and manage RPC instances, including `createRpc`. This file is central to the creation and management of RPC channels and their associated handlers.
- [server.ts](./src/server.ts): Contains the server-side implementation for managing RPC operations. It includes functions to create RPC channels for options and to populate options functions.
- [types.ts](./src/types.ts): Defines various types used throughout the package, such as `AgentContextCallFunctions` and `RpcInvokeFunctions`. These types are essential for ensuring type safety and consistency across the package.

## How to extend

To extend the `@typeagent/agent-rpc` package, follow these steps:

1. **Identify the area to extend**: Determine whether you need to extend client-side, server-side, or shared functionality.
2. **Open the relevant file**: Depending on the area you identified, open one of the following files:
   - [client.ts](./src/client.ts) for client-side extensions.
   - [server.ts](./src/server.ts) for server-side extensions.
   - [common.ts](./src/common.ts) for shared types and utilities.
   - [rpc.ts](./src/rpc.ts) for RPC instance management.
3. **Follow existing patterns**: Review the existing code to understand the patterns and conventions used. Implement your changes following these patterns.
4. **Test your changes**: Ensure your changes are thoroughly tested. Add new tests if necessary to cover the extended functionality.

By following these steps, you can effectively extend the `@typeagent/agent-rpc` package to meet your specific requirements.

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
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../packages/agentServer/server/README.md)
- [agent-shell](../../packages/shell/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [dispatcher-node-providers](../../packages/dispatcher/nodeProviders/README.md)
- _…and 6 more workspace consumers._

### Files of interest

- [./src/client.ts](./src/client.ts)
- [./src/common.ts](./src/common.ts)
- [./src/rpc.ts](./src/rpc.ts)
- [./src/server.ts](./src/server.ts)
- [./src/tsconfig.json](./src/tsconfig.json)
- [./src/types.ts](./src/types.ts)

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-rpc docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
