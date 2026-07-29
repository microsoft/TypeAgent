<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6d24f96a52fe0007674f483649e286581451bcfa1fa5fe5bd4cea09acb49034b -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/websocket-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/websocket-utils` package provides a set of utility functions and modules for managing WebSocket connections within the TypeAgent project. It simplifies the creation, configuration, and maintenance of WebSocket connections, enabling efficient communication between system components.

This library is designed to handle WebSocket-specific tasks such as connection setup, origin validation, heartbeat monitoring, and retry logic. It is used by multiple agents and services across the TypeAgent ecosystem.

## What it does

The package offers several key features for working with WebSockets:

- **WebSocket Connection Management**: The `createWebSocket` function in [webSockets.ts](./src/webSockets.ts) facilitates the creation of WebSocket connections. It constructs the WebSocket endpoint using parameters such as channel, role, client ID, port, and session ID. The WebSocket host is determined by the `WEBSOCKET_HOST` environment variable.
- **Message Structure**: The `WebSocketMessageV2` type defines the structure of messages exchanged over WebSocket connections, including fields for method, parameters, results, and errors.

- **Origin Allowlist**: The [originAllowlist.ts](./src/originAllowlist.ts) module provides functionality to define and enforce an allowlist of origins that are permitted to connect to the WebSocket server. This is useful for enhancing security by restricting access to trusted origins.

- **Heartbeat Monitoring**: The [heartbeat.ts](./src/heartbeat.ts) module implements RFC 6455 ping/pong liveness checks. It ensures that inactive or unresponsive WebSocket clients are detected and terminated, maintaining the health of the connection pool.

- **Exponential Backoff**: The [backoff.ts](./src/backoff.ts) module provides a mechanism for retrying failed WebSocket connections with exponential delays. This helps manage reconnection attempts in a controlled manner.

- **RPC Channel Integration**: The [rpcChannel.ts](./src/rpcChannel.ts) module adapts WebSocket connections to the `agent-rpc` `RpcChannel` interface, enabling JSON-based message exchange and integration with the broader TypeAgent RPC system.

These features collectively support reliable WebSocket communication and are used by various agents and services in the TypeAgent project.

## Setup

To use the `@typeagent/websocket-utils` package, you need to configure the `WEBSOCKET_HOST` environment variable. This variable specifies the host for WebSocket connections.

1. Set the `WEBSOCKET_HOST` environment variable:
   - Directly in your shell:
     ```sh
     export WEBSOCKET_HOST="ws://your-websocket-host"
     ```
   - Or in a `.env` file in your project directory:
     ```text
     WEBSOCKET_HOST=ws://your-websocket-host
     ```

For additional setup details, refer to the hand-written README.

## Key Files

The package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: Serves as the entry point for the package, re-exporting functions and types from [webSockets.ts](./src/webSockets.ts).

- **[webSockets.ts](./src/webSockets.ts)**: Contains the `createWebSocket` function, which is the primary method for establishing WebSocket connections. It also defines the `WebSocketMessageV2` type for structuring WebSocket messages.

- **[originAllowlist.ts](./src/originAllowlist.ts)**: Implements logic for managing an origin allowlist, ensuring that only trusted origins can connect to the WebSocket server.

- **[heartbeat.ts](./src/heartbeat.ts)**: Provides functionality for monitoring WebSocket connection liveness using ping/pong messages. It detects and terminates unresponsive clients.

- **[rpcChannel.ts](./src/rpcChannel.ts)**: Adapts WebSocket connections to the `agent-rpc` `RpcChannel` interface, enabling JSON-based communication and integration with the TypeAgent RPC system.

- **[backoff.ts](./src/backoff.ts)**: Implements an exponential backoff mechanism for retrying failed WebSocket connections. It provides configurable options for base delay and maximum delay.

- **[tsconfig.json](./src/tsconfig.json)**: TypeScript configuration file that extends the base configuration and specifies compiler options for the package.

## How to extend

To extend the functionality of the `@typeagent/websocket-utils` package, follow these steps:

1. **Understand the Existing Code**:

   - Start by reviewing the [webSockets.ts](./src/webSockets.ts) file to understand how WebSocket connections are created and managed.
   - Explore other modules such as [originAllowlist.ts](./src/originAllowlist.ts) and [heartbeat.ts](./src/heartbeat.ts) to see how they contribute to the overall functionality.

2. **Add New Features**:

   - Introduce new functions or modify existing ones to support additional WebSocket features or configurations.
   - For example, you could add support for custom authentication headers or implement new message types.

3. **Handle New Configurations**:

   - If your changes require new environment variables or configuration options, ensure they are documented and integrated into the existing setup process.

4. **Write Tests**:

   - Add unit tests for your new or modified functions to verify their correctness and compatibility with the existing codebase.
   - Use the following command to run tests:
     ```sh
     pnpm test
     ```

5. **Follow Project Standards**:
   - Adhere to the coding and documentation standards used in the TypeAgent project. Review similar modules for guidance on naming conventions and patterns.

By following these steps, you can extend the `@typeagent/websocket-utils` package to meet your specific requirements while maintaining compatibility with the rest of the TypeAgent ecosystem.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./originAllowlist` → [./dist/originAllowlist.js](./dist/originAllowlist.js)
- `./heartbeat` → [./dist/heartbeat.js](./dist/heartbeat.js)
- `./rpcChannel` → [./dist/rpcChannel.js](./dist/rpcChannel.js)
- `./backoff` → [./dist/backoff.js](./dist/backoff.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/config](../../../packages/config/README.md)

External: `debug`, `dotenv`, `find-config`, `isomorphic-ws`, `ws`

### Used by

- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [code-agent](../../../packages/agents/code/README.md)
- [markdown-agent](../../../packages/agents/markdown/README.md)
- [montage-agent](../../../packages/agents/montage/README.md)
- studio-agent
- [studio-service](../../../packages/studio-service/README.md)
- [typeagent-studio](../../../packages/typeagent-studio/README.md)
- [visualstudio-agent](../../../packages/agents/visualStudio/README.md)
- [vscode-shell](../../../packages/vscode-shell/README.md)
- _…and 1 more workspace consumers._

### Files of interest

- [./src/index.ts](./src/index.ts)
- [./src/backoff.ts](./src/backoff.ts)
- [./src/heartbeat.ts](./src/heartbeat.ts)
- [./src/originAllowlist.ts](./src/originAllowlist.ts)
- [./src/rpcChannel.ts](./src/rpcChannel.ts)
- [./src/tsconfig.json](./src/tsconfig.json)
- [./src/webSockets.ts](./src/webSockets.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `WEBSOCKET_HOST`

---

_Auto-generated against commit `10c156699bb8436ffeeb5042da164ea166f9eb74` on `2026-07-22T11:31:33.221Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/websocket-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
