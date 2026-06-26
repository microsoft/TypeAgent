<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=461e752d139edda1a3037df231b45d6b365077756a3555f706d11e4b2251110f -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# studio-service — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `studio-service` package is the standalone, per-workspace host of the TypeAgent Studio runtime (`@typeagent/core/runtime`) and its typed `agent-rpc` service channel. It is designed to run independently within a developer's workspace, providing a dedicated environment for the Studio runtime. This package is launched by the `typeagent-studio` extension or the `typeagent-studio serve` CLI, and serves as the backend for the `studio` agent and the extension.

## What it does

The `studio-service` package provides several key functionalities:

- **Studio Runtime Hosting**: It hosts the Studio runtime, which is responsible for managing the workspace state and executing various actions within the developer's workspace.
- **Service Channel**: It establishes a typed `agent-rpc` service channel that allows communication between the Studio runtime and its clients (the `studio` agent and the extension).
- **Workspace State Management**: It uses a durable, file-backed `StudioWorkspaceState` to persist runtime state across service restarts.
- **Service Discovery and Registry**: It includes mechanisms for announcing the service and discovering its port and token, enabling clients to connect and interact with the service.
- **Proxy Client**: It provides a minimal client for the `studio` agent to forward read-only actions to the standalone Studio service.

The package supports actions such as `createMessage`, `deleteMessage`, `updateMessage`, and `fetchMessages`, among others, which are grouped thematically to manage messages within the workspace.

## Setup

To set up the `studio-service` package, you need to configure the following environment variable:

- `TYPEAGENT_STUDIO_REPO_ROOT`: This variable specifies the root directory of the repository that the Studio service should inspect. It can be set to an explicit path if the agent runs outside the repository it should inspect. If not set, the service will use the current working directory.

Ensure that this environment variable is correctly set in your shell or `.env` file before launching the service.

## Key Files

The `studio-service` package consists of several key files, each responsible for different aspects of the service:

- [`index.ts`](./src/index.ts): The entry point of the package, exposing the external surface consumed by the `studio` agent.
- [`main.ts`](./src/main.ts): The process entry point for launching the standalone Studio service. It parses command-line arguments and starts the service.
- [`fileWorkspaceState.ts`](./src/fileWorkspaceState.ts): Manages the durable, file-backed workspace state, ensuring that runtime state persists across service restarts.
- [`runtime.ts`](./src/runtime.ts): Contains functions for resolving repository root candidates and creating the Studio runtime core.
- [`studioRegistry.ts`](./src/studioRegistry.ts): Implements the service registry relay, allowing the service to announce itself and enabling clients to discover it.
- [`studioRpcHandlers.ts`](./src/studioRpcHandlers.ts): Defines the typed invoke handlers exposed by the Studio service over the channel.
- [`studioService.ts`](./src/studioService.ts): Contains the logic for starting and managing a running Studio service instance.
- [`studioServiceProxyClient.ts`](./src/studioServiceProxyClient.ts): Provides a minimal client for the `studio` agent to forward read-only actions to the Studio service.

## How to extend

To extend the `studio-service` package, follow these steps:

1. **Open the `index.ts` file**: This file serves as the entry point and exposes the package's external surface. Start here to understand the overall structure and exported functions.
2. **Explore the `main.ts` file**: This file contains the logic for launching the service. If you need to modify the startup process or add new command-line arguments, this is the place to do it.
3. **Modify `fileWorkspaceState.ts`**: If you need to change how the workspace state is managed or add new state persistence mechanisms, update this file.
4. **Enhance `runtime.ts`**: To add new runtime functionalities or modify repository root resolution, make changes in this file.
5. **Update `studioRegistry.ts`**: If you need to change how the service announces itself or how clients discover it, this is the file to modify.
6. **Add new RPC handlers in `studioRpcHandlers.ts`**: To extend the set of actions exposed by the service, define new handlers in this file.
7. **Extend `studioService.ts`**: To add new functionalities to the running service instance, update this file.
8. **Modify `studioServiceProxyClient.ts`**: If you need to change how the `studio` agent interacts with the service, make changes in this file.

After making your changes, ensure that you run the tests to verify that everything works as expected. The package's tests import the necessary modules directly and can be found alongside the implementation files.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/core](../../packages/typeagent-core/README.md)
- [@typeagent/websocket-utils](../../packages/utils/webSocketUtils/README.md)

External: `debug`, `ws`

### Used by

- studio-agent

### Files of interest

`./src/index.ts`, `./src/main.ts`, `./src/fileWorkspaceState.ts`, …and 7 more under `./src/`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_STUDIO_REPO_ROOT`

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter studio-service docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
