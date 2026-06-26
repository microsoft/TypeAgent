<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=bdb0b773989463abdafd92bcf6922414d0b0cf6c6ab17b08f052334244ef6178 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/dispatcher-rpc — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/dispatcher-rpc` package provides Remote Procedure Call (RPC) functionality for the TypeAgent dispatcher. It facilitates communication between different components of the TypeAgent system, enabling them to invoke methods and exchange data over RPC channels.

## What it does

This package offers RPC clients and servers for two main components: `ClientIO` and `Dispatcher`. It allows these components to communicate with each other and perform various actions. The package includes functions for handling user requests, managing display information, processing commands, and more.

### ClientIO

The `ClientIO` component handles user interactions and display management. It includes actions such as `clear`, `exit`, `shutdown`, `setUserRequest`, `setDisplayInfo`, `setDisplay`, `appendDisplay`, `appendDiagnosticData`, and `setDynamicDisplay`. These actions enable the client to manage the display and respond to user inputs.

### Dispatcher

The `Dispatcher` component processes commands and manages dynamic displays. It includes actions such as `submitCommand`, `getDynamicDisplay`, `getTemplateSchema`, `getTemplateCompletion`, `getCommandCompletion`, `checkCache`, `close`, and `getStatus`. These actions allow the dispatcher to handle commands, retrieve display information, and manage templates.

## Setup

To set up the `@typeagent/dispatcher-rpc` package, ensure you have the necessary dependencies installed. The package relies on `@typeagent/agent-rpc`, `@typeagent/agent-sdk`, and `@typeagent/dispatcher-types`. You can install these dependencies using `pnpm install`.

No additional environment variables or external accounts are required for this package. For detailed setup instructions, see the hand-written README.

## Key Files

The package is organized into several key files:

- [clientIOClient.ts](./src/clientIOClient.ts): Defines the RPC client for `ClientIO`.
- [clientIOServer.ts](./src/clientIOServer.ts): Defines the RPC server for `ClientIO`.
- [dispatcherClient.ts](./src/dispatcherClient.ts): Defines the RPC client for `Dispatcher`.
- [dispatcherServer.ts](./src/dispatcherServer.ts): Defines the RPC server for `Dispatcher`.
- [clientIOTypes.ts](./src/clientIOTypes.ts): Contains type definitions for `ClientIO` RPC functions.
- [dispatcherTypes.ts](./src/dispatcherTypes.ts): Contains type definitions for `Dispatcher` RPC functions.
- [types.ts](./src/types.ts): Re-exports types from `@typeagent/dispatcher-types` and `@typeagent/agent-sdk`.

The package uses the `createRpc` function from `@typeagent/agent-rpc` to create RPC clients and servers. The clients and servers are responsible for sending and receiving RPC calls, invoking functions, and handling responses.

## How to extend

To extend the `@typeagent/dispatcher-rpc` package, follow these steps:

1. **Identify the component to extend**: Determine whether you need to extend `ClientIO` or `Dispatcher`.

2. **Add new actions**: Define new actions in the appropriate type definition file (`clientIOTypes.ts` or `dispatcherTypes.ts`). Ensure the actions are correctly typed.

3. **Implement the actions**: Implement the new actions in the corresponding client and server files (`clientIOClient.ts`, `clientIOServer.ts`, `dispatcherClient.ts`, `dispatcherServer.ts`). Use the `createRpc` function to handle RPC communication.

4. **Test the changes**: Write tests to verify the new actions work as expected. Ensure the tests cover both client and server functionality.

5. **Run the tests**: Execute the tests to validate your changes. Ensure all tests pass before committing your code.

By following these steps, you can extend the functionality of the `@typeagent/dispatcher-rpc` package to meet your specific requirements.

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/dispatcher-rpc docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
