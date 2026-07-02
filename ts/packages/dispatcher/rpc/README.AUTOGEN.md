<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=2de31c78623cb18ac24e0653af2069ee753e0483efef2ce67e09e930219df1f8 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/dispatcher-rpc — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/dispatcher-rpc` package provides Remote Procedure Call (RPC) functionality for the TypeAgent dispatcher. It enables communication between different components of the TypeAgent system, allowing them to invoke methods and exchange data over RPC channels.

## What it does

This package implements RPC clients and servers for two primary components: `ClientIO` and `Dispatcher`. These components facilitate communication and coordination within the TypeAgent system.

### ClientIO

The `ClientIO` component is responsible for managing user interactions and display updates. It supports actions such as:

- `clear`, `exit`, and `shutdown` for managing session state.
- `setUserRequest` for handling user input.
- `setDisplayInfo`, `setDisplay`, and `appendDisplay` for updating display content.
- `appendDiagnosticData` and `setDynamicDisplay` for managing diagnostic and dynamic display data.

These actions allow the `ClientIO` component to handle user-facing operations and maintain the display state.

### Dispatcher

The `Dispatcher` component focuses on processing commands and managing dynamic displays. It includes actions such as:

- `submitCommand` for submitting commands to the dispatcher.
- `getDynamicDisplay`, `getTemplateSchema`, and `getTemplateCompletion` for retrieving display and template-related data.
- `getCommandCompletion` and `checkCache` for managing command execution and caching.
- `close` and `getStatus` for managing the dispatcher lifecycle and retrieving its status.

The `Dispatcher` component is central to coordinating command execution and managing templates within the system.

## Setup

To use the `@typeagent/dispatcher-rpc` package, ensure the following dependencies are installed:

- `@typeagent/agent-rpc`
- `@typeagent/agent-sdk`
- `@typeagent/dispatcher-types`

You can install these dependencies using `pnpm install`. No additional environment variables or external accounts are required. For more details, refer to the hand-written README.

## Key Files

The package is organized into several key files, each serving a specific purpose:

- [clientIOClient.ts](./src/clientIOClient.ts): Implements the RPC client for the `ClientIO` component, enabling it to send requests and receive responses.
- [clientIOServer.ts](./src/clientIOServer.ts): Implements the RPC server for the `ClientIO` component, handling incoming requests and invoking the appropriate actions.
- [dispatcherClient.ts](./src/dispatcherClient.ts): Implements the RPC client for the `Dispatcher` component, providing methods to interact with the dispatcher remotely.
- [dispatcherServer.ts](./src/dispatcherServer.ts): Implements the RPC server for the `Dispatcher` component, processing incoming commands and managing dispatcher state.
- [clientIOTypes.ts](./src/clientIOTypes.ts): Defines type information for `ClientIO` RPC functions, including both callable and invokable actions.
- [dispatcherTypes.ts](./src/dispatcherTypes.ts): Defines type information for `Dispatcher` RPC functions, including wire-side variants of certain types.
- [types.ts](./src/types.ts): Re-exports types from `@typeagent/dispatcher-types` and `@typeagent/agent-sdk` for convenience.

The package uses the `createRpc` function from `@typeagent/agent-rpc` to establish RPC communication between clients and servers. This function is central to the implementation of the RPC layer.

## How to extend

To extend the functionality of the `@typeagent/dispatcher-rpc` package, follow these steps:

1. **Determine the target component**: Decide whether you need to extend the `ClientIO` or `Dispatcher` component based on your requirements.

2. **Define new actions**: Add the new actions to the appropriate type definition file:

   - Use [clientIOTypes.ts](./src/clientIOTypes.ts) for `ClientIO` actions.
   - Use [dispatcherTypes.ts](./src/dispatcherTypes.ts) for `Dispatcher` actions.

3. **Implement the actions**: Add the implementation for the new actions in the corresponding client and server files:

   - For `ClientIO`, modify [clientIOClient.ts](./src/clientIOClient.ts) and [clientIOServer.ts](./src/clientIOServer.ts).
   - For `Dispatcher`, modify [dispatcherClient.ts](./src/dispatcherClient.ts) and [dispatcherServer.ts](./src/dispatcherServer.ts).

4. **Update the RPC layer**: Use the `createRpc` function from `@typeagent/agent-rpc` to handle the new actions in the RPC communication layer.

5. **Write tests**: Create unit tests to verify the functionality of the new actions. Ensure that both client and server behaviors are tested.

6. **Run tests**: Execute the test suite to confirm that your changes work as expected and do not introduce regressions.

By following these steps, you can extend the `@typeagent/dispatcher-rpc` package to support additional functionality or integrate new features into the TypeAgent system.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./types` → `./dist/types.js` _(not found on disk)_
- `./clientio/client` → `./dist/clientIOClient.js` _(not found on disk)_
- `./clientio/server` → `./dist/clientIOServer.js` _(not found on disk)_
- `./dispatcher/client` → `./dist/dispatcherClient.js` _(not found on disk)_
- `./dispatcher/server` → `./dist/dispatcherServer.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)

External: _None at runtime._

### Used by

- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../../packages/agentServer/protocol/README.md)
- [agent-api](../../../packages/api/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- visualstudio-extension-webview
- [vscode-shell](../../../packages/vscode-shell/README.md)

### Files of interest

- [./src/clientIOClient.ts](./src/clientIOClient.ts)
- [./src/clientIOServer.ts](./src/clientIOServer.ts)
- [./src/clientIOTypes.ts](./src/clientIOTypes.ts)
- [./src/dispatcherClient.ts](./src/dispatcherClient.ts)
- [./src/dispatcherServer.ts](./src/dispatcherServer.ts)
- [./src/dispatcherTypes.ts](./src/dispatcherTypes.ts)
- [./src/tsconfig.json](./src/tsconfig.json)
- [./src/types.ts](./src/types.ts)

---

_Auto-generated against commit `ff379b098decfab4eb45f78b6fa318358d7fbd75` on `2026-07-01T09:05:58.471Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/dispatcher-rpc docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
