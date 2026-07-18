<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=970a06a8ce3153174d604c8d817bdfc619436a392e1b733e218d3213467b5758 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/dispatcher-rpc — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/dispatcher-rpc` package provides Remote Procedure Call (RPC) functionality for the TypeAgent dispatcher. It serves as a bridge for communication between different components of the TypeAgent system, enabling them to invoke methods and exchange data over RPC channels. This package is a core part of the TypeAgent architecture, facilitating both user-facing interactions and backend command processing.

## What it does

This package implements RPC clients and servers for two primary components: `ClientIO` and `Dispatcher`. These components are responsible for distinct but complementary roles within the TypeAgent system.

### ClientIO

The `ClientIO` component handles user interactions and display updates. It supports a range of actions, including:

- **Session Management**: Actions like `clear`, `exit`, and `shutdown` manage the session state.
- **User Input**: The `setUserRequest` action processes user commands or inputs.
- **Display Updates**: Actions such as `setDisplayInfo`, `setDisplay`, and `appendDisplay` update the user interface with new information.
- **Diagnostics and Dynamic Displays**: Actions like `appendDiagnosticData` and `setDynamicDisplay` manage diagnostic information and dynamic display elements.

These actions enable `ClientIO` to act as the interface between the user and the system, ensuring a responsive and interactive experience.

### Dispatcher

The `Dispatcher` component is focused on command processing and dynamic display management. Key actions include:

- **Command Submission**: The `submitCommand` action allows clients to send commands to the dispatcher for processing.
- **Display and Template Management**: Actions like `getDynamicDisplay`, `getTemplateSchema`, and `getTemplateCompletion` provide access to display and template-related data.
- **Command Execution and Caching**: The `getCommandCompletion` and `checkCache` actions manage the execution of commands and their caching.
- **Lifecycle Management**: Actions such as `close` and `getStatus` handle the lifecycle and status of the dispatcher.

The `Dispatcher` is a central component for coordinating command execution and managing templates, ensuring that the system operates efficiently and effectively.

## Setup

To use the `@typeagent/dispatcher-rpc` package, ensure the following dependencies are installed in your project:

- `@typeagent/agent-rpc`
- `@typeagent/agent-sdk`
- `@typeagent/dispatcher-types`

You can install these dependencies using the following command:

```bash
pnpm install
```

No additional environment variables or external accounts are required for setup. For more details, refer to the hand-written README.

## Key Files

The package is organized into several key files, each with a specific role in implementing the RPC functionality:

- **[clientIOClient.ts](./src/clientIOClient.ts)**: Implements the RPC client for the `ClientIO` component, enabling it to send requests and receive responses.
- **[clientIOServer.ts](./src/clientIOServer.ts)**: Implements the RPC server for the `ClientIO` component, handling incoming requests and invoking the appropriate actions.
- **[dispatcherClient.ts](./src/dispatcherClient.ts)**: Implements the RPC client for the `Dispatcher` component, providing methods to interact with the dispatcher remotely.
- **[dispatcherServer.ts](./src/dispatcherServer.ts)**: Implements the RPC server for the `Dispatcher` component, processing incoming commands and managing dispatcher state.
- **[clientIOTypes.ts](./src/clientIOTypes.ts)**: Defines type information for `ClientIO` RPC functions, including callable and invokable actions.
- **[dispatcherTypes.ts](./src/dispatcherTypes.ts)**: Defines type information for `Dispatcher` RPC functions, including wire-side variants of certain types.
- **[types.ts](./src/types.ts)**: Re-exports types from `@typeagent/dispatcher-types` and `@typeagent/agent-sdk` for convenience.

The package relies on the `createRpc` function from `@typeagent/agent-rpc` to establish and manage RPC communication between clients and servers. This function is a cornerstone of the package's architecture.

## How to extend

To extend the `@typeagent/dispatcher-rpc` package, follow these steps:

1. **Identify the target component**: Determine whether your extension applies to the `ClientIO` or `Dispatcher` component.

2. **Define new actions**: Add the new actions to the appropriate type definition file:

   - Use [clientIOTypes.ts](./src/clientIOTypes.ts) for `ClientIO` actions.
   - Use [dispatcherTypes.ts](./src/dispatcherTypes.ts) for `Dispatcher` actions.

3. **Implement the actions**: Add the implementation for the new actions in the corresponding client and server files:

   - For `ClientIO`, modify [clientIOClient.ts](./src/clientIOClient.ts) and [clientIOServer.ts](./src/clientIOServer.ts).
   - For `Dispatcher`, modify [dispatcherClient.ts](./src/dispatcherClient.ts) and [dispatcherServer.ts](./src/dispatcherServer.ts).

4. **Update the RPC layer**: Use the `createRpc` function from `@typeagent/agent-rpc` to handle the new actions in the RPC communication layer.

5. **Write tests**: Create unit tests to verify the functionality of the new actions. Ensure that both client and server behaviors are tested.

6. **Run tests**: Execute the test suite to confirm that your changes work as expected and do not introduce regressions.

By following these steps, you can effectively extend the `@typeagent/dispatcher-rpc` package to meet new requirements or integrate additional features into the TypeAgent system.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./types` → [./dist/types.js](./dist/types.js)
- `./clientio/client` → [./dist/clientIOClient.js](./dist/clientIOClient.js)
- `./clientio/server` → [./dist/clientIOServer.js](./dist/clientIOServer.js)
- `./dispatcher/client` → [./dist/dispatcherClient.js](./dist/dispatcherClient.js)
- `./dispatcher/server` → [./dist/dispatcherServer.js](./dist/dispatcherServer.js)

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

_Auto-generated against commit `5cbcf613f047f08749d0451296eb1cdc610ae414` on `2026-07-17T18:24:18.404Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/dispatcher-rpc docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
