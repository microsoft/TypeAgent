<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=73dadfbf600f2af147e827f64b864d0c9c5f044de094acd81822fea54f1cf82a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# websocket-channel-server — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `websocket-channel-server` package provides a WebSocket server implementation for RpcChannel communication within the TypeAgent monorepo. It is designed to facilitate real-time communication between different parts of the system using WebSockets, enabling efficient and reliable RPC (Remote Procedure Call) channels.

## What it does

The `websocket-channel-server` package enables the creation and management of a WebSocket server that handles RPC channels. It provides functionalities to:

- Set up the WebSocket server.
- Manage WebSocket connections.
- Enforce origin policies.
- Handle RPC messages.

This package integrates with other TypeAgent packages such as `@typeagent/agent-rpc`, `@typeagent/common-utils`, and `@typeagent/websocket-utils` to provide a comprehensive solution for RPC communication over WebSockets. It is used by several other packages within the TypeAgent monorepo, including `@typeagent/agent-server-client`, `agent-server`, and `agent-shell`.

## Setup

To set up the `websocket-channel-server` package, follow these steps:

1. Install the necessary dependencies:

   ```sh
   pnpm install @typeagent/agent-rpc @typeagent/common-utils @typeagent/websocket-utils debug ws
   ```

2. Ensure that the environment variables and configuration options are set up as required. Refer to the hand-written README for detailed setup instructions.

No additional environment variables are required for this package beyond the standard configuration for WebSocket servers.

## Key Files

The package's architecture is centered around the WebSocket server implementation. Key files include:

- [index.ts](./src/index.ts): This file exports the main functionalities of the package, primarily the server implementation.
- [server.ts](./src/server.ts): Contains the core logic for setting up and managing the WebSocket server, including handling connections and RPC channels.
- [heartbeat.ts](./src/heartbeat.ts): Re-exports heartbeat primitives from `@typeagent/websocket-utils` for liveness checks.
- [tsconfig.json](./src/tsconfig.json): TypeScript configuration file that sets up the compiler options and project structure.

### Key Components

- **WebSocketChannelServer**: Defined in [server.ts](./src/server.ts), this type represents the WebSocket server and includes methods for managing connections and handling RPC messages.
- **WebSocketChannelServerOptions**: An interface that extends `ws.ServerOptions` with additional options for origin allowlist, allowing for more granular control over which origins are permitted to connect.

### Core Logic

The core logic for the WebSocket server is implemented in [server.ts](./src/server.ts). This file includes functions for:

- Creating and managing WebSocket connections.
- Enforcing origin policies based on the `originAllowlist` option.
- Handling RPC messages using the `ChannelProvider` and `createChannelProviderAdapter` from `@typeagent/agent-rpc`.

## How to extend

To extend the `websocket-channel-server` package, follow these steps:

1. Open the [server.ts](./src/server.ts) file. This is where the core logic for the WebSocket server is implemented.
2. Add new functionalities or modify existing ones by extending the `WebSocketChannelServer` type or the `WebSocketChannelServerOptions` interface.
3. Implement additional handlers or utilities as needed to support new features or improve existing ones.
4. Write tests to ensure your changes work as expected. You can add test cases in the appropriate test files within the package.

By following these steps, you can effectively extend the capabilities of the `websocket-channel-server` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/websocket-utils](../../../packages/utils/webSocketUtils/README.md)

External: `debug`, `ws`

### Used by

- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [code-agent](../../../packages/agents/code/README.md)

### Files of interest

`./src/index.ts`, `./src/heartbeat.ts`, `./src/server.ts`, …and 1 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter websocket-channel-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
