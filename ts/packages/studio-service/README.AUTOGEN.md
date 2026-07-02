<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=75c47c2e2e833b8a591d6b846baa39d35d1ec16eeecacced2403394e18012454 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# studio-service — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `studio-service` package is a standalone, per-workspace host for the TypeAgent Studio runtime (`@typeagent/core/runtime`) and its typed `agent-rpc` service channel. It is designed to operate independently within a developer's workspace, providing a dedicated environment for managing workspace state and facilitating communication between the Studio runtime and its clients. This service is typically launched by the `typeagent-studio` extension or the `typeagent-studio serve` CLI.

## What it does

The `studio-service` package provides the following core functionalities:

- **Hosting the Studio Runtime**: The package runs the Studio runtime, which is responsible for managing workspace state and executing actions within the developer's workspace.
- **Typed Service Channel**: It establishes a typed `agent-rpc` service channel, enabling communication between the Studio runtime and its clients, such as the `studio` agent and the `typeagent-studio` extension.
- **Workspace State Management**: The service uses a durable, file-backed `StudioWorkspaceState` to persist runtime state across service restarts, ensuring continuity.
- **Service Discovery and Registration**: The service includes mechanisms for announcing its availability, discovering its port and token, and enabling clients to connect securely.
- **Proxy Client**: A minimal client is provided for the `studio` agent to forward read-only actions to the standalone Studio service.

The package supports a range of actions, including workspace state management and communication with the Studio runtime. These actions are exposed through typed `agent-rpc` handlers, which are defined in the [studioRpcHandlers.ts](./src/studioRpcHandlers.ts) file.

## Setup

To configure and run the `studio-service` package, you need to set the following environment variable:

- `TYPEAGENT_STUDIO_REPO_ROOT`: Specifies the root directory of the repository that the Studio service should inspect. If this variable is not set, the service defaults to using the current working directory. You can set this variable in your shell or `.env` file.

Ensure that this environment variable is correctly configured before launching the service. The service can be started using the `typeagent-studio serve` CLI or programmatically via its API.

## Key Files

The `studio-service` package is organized into several key files, each responsible for specific aspects of the service:

- [`index.ts`](./src/index.ts): The main entry point of the package, exposing the external API consumed by the `studio` agent and other clients.
- [`main.ts`](./src/main.ts): The process entry point for launching the standalone Studio service. It handles command-line arguments and initializes the service.
- [`fileWorkspaceState.ts`](./src/fileWorkspaceState.ts): Implements a durable, file-backed workspace state to persist runtime data across service restarts.
- [`runtime.ts`](./src/runtime.ts): Provides functions for resolving repository root candidates and creating the Studio runtime core.
- [`studioRegistry.ts`](./src/studioRegistry.ts): Implements the service registry, enabling the service to announce itself and allowing clients to discover and connect to it.
- [`studioRpcHandlers.ts`](./src/studioRpcHandlers.ts): Defines the typed `agent-rpc` handlers that expose the service's functionality to clients.
- [`studioService.ts`](./src/studioService.ts): Contains the logic for starting and managing a running Studio service instance.
- [`studioServiceProxyClient.ts`](./src/studioServiceProxyClient.ts): Provides a minimal client for the `studio` agent to forward read-only actions to the Studio service.

## How to extend

To extend the `studio-service` package, follow these steps:

1. **Understand the entry point**: Start with [index.ts](./src/index.ts) to understand the external API and how the package is structured.
2. **Modify the service startup**: If you need to change how the service is launched or add new command-line options, update [main.ts](./src/main.ts).
3. **Enhance workspace state management**: To modify how the workspace state is persisted or add new features, work on [fileWorkspaceState.ts](./src/fileWorkspaceState.ts).
4. **Extend runtime capabilities**: To add new runtime features or modify repository root resolution, update [runtime.ts](./src/runtime.ts).
5. **Update service discovery**: If you need to change how the service announces itself or how clients discover it, modify [studioRegistry.ts](./src/studioRegistry.ts).
6. **Add new actions**: Define additional `agent-rpc` handlers in [studioRpcHandlers.ts](./src/studioRpcHandlers.ts) to expose new functionalities.
7. **Enhance service logic**: To add new features to the running service instance, update [studioService.ts](./src/studioService.ts).
8. **Modify the proxy client**: If the `studio` agent's interaction with the service needs to change, update [studioServiceProxyClient.ts](./src/studioServiceProxyClient.ts).

After making changes, ensure that you run the package's tests to verify the functionality. Tests are located alongside the implementation files and are designed to validate the behavior of individual components.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

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

_Auto-generated against commit `ff379b098decfab4eb45f78b6fa318358d7fbd75` on `2026-07-01T09:05:58.471Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter studio-service docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
