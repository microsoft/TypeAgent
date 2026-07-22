<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=24aed57a01ebd30ed688595550100934919851509b5d15c7b930a66c1c7957d1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# websocket-channel-server — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `websocket-channel-server` package provides a WebSocket server implementation for managing RpcChannel communication within the TypeAgent monorepo. It serves as a foundational utility for enabling real-time, bidirectional communication between various components of the system using WebSockets. This package is widely used across the monorepo to facilitate Remote Procedure Call (RPC) interactions.

## What it does

The `websocket-channel-server` package is responsible for creating and managing a WebSocket server that supports RPC communication. Its key capabilities include:

- **WebSocket Server Setup**: Initializes and configures a WebSocket server using the `ws` library.
- **Connection Management**: Handles WebSocket connections, including opening, closing, and maintaining active sessions.
- **Origin Policy Enforcement**: Provides an optional mechanism to restrict connections based on the `Origin` header, ensuring only trusted clients can connect.
- **RPC Message Handling**: Integrates with `@typeagent/agent-rpc` to process RPC messages over WebSocket channels.
- **Heartbeat Support**: Re-exports heartbeat utilities from `@typeagent/websocket-utils` for liveness checks, ensuring connections remain active and responsive.

This package integrates with other utilities in the TypeAgent ecosystem, such as `@typeagent/agent-rpc`, `@typeagent/common-utils`, and `@typeagent/websocket-utils`, to provide a cohesive solution for WebSocket-based RPC communication. It is a critical dependency for several other packages, including `@typeagent/agent-server-client`, `agent-server`, and `agent-shell`.

## Setup

To use the `websocket-channel-server` package, follow these steps:

1. **Install Dependencies**: Ensure the required dependencies are installed in your project. Run the following command:

   ```sh
   pnpm install @typeagent/agent-rpc @typeagent/common-utils @typeagent/websocket-utils debug ws
   ```

2. **Configuration**: No additional environment variables are required for this package. However, you may need to configure the `WebSocketChannelServerOptions` interface to suit your application's needs, such as specifying an `isOriginAllowed` function for origin policy enforcement.

For more detailed setup instructions, refer to the hand-written README.

## Key Files

The package's implementation is organized into several key files, each responsible for specific aspects of the WebSocket server:

- **[index.ts](./src/index.ts)**: The main entry point of the package. It re-exports functionalities from other files, including the server implementation and heartbeat utilities.
- **[server.ts](./src/server.ts)**: Contains the core logic for the WebSocket server, including connection management, origin policy enforcement, and RPC message handling.
- **[heartbeat.ts](./src/heartbeat.ts)**: Re-exports heartbeat utilities from `@typeagent/websocket-utils`, providing liveness check primitives for both server and client contexts.
- **[tsconfig.json](./src/tsconfig.json)**: Configures TypeScript compiler options for the package, ensuring proper build and type-checking behavior.

### Core Components

1. **WebSocketChannelServer**: Defined in [server.ts](./src/server.ts), this type represents the WebSocket server instance. It includes methods for managing connections and handling RPC messages.
2. **WebSocketChannelServerOptions**: An interface extending `ws.ServerOptions` with additional options, such as `isOriginAllowed`, for customizing server behavior.
3. **Heartbeat Utilities**: Re-exported from `@typeagent/websocket-utils`, these utilities enable liveness checks to ensure active and responsive WebSocket connections.

### Key Functions

- **`createWebSocketChannelServer`**: The primary function for initializing a WebSocket server. It accepts `WebSocketChannelServerOptions` and a connection handler callback, which processes incoming connections and establishes RPC channels.
- **`attachHeartbeat`**: A utility for adding heartbeat functionality to WebSocket connections, ensuring they remain active and responsive.

## How to extend

To extend the functionality of the `websocket-channel-server` package, follow these steps:

1. **Understand the Core Logic**: Start by reviewing the [server.ts](./src/server.ts) file, which contains the main implementation of the WebSocket server. Familiarize yourself with the `createWebSocketChannelServer` function and its options.

2. **Add New Features**:

   - Extend the `WebSocketChannelServerOptions` interface to include additional configuration options.
   - Implement new connection handlers or message processing logic to support custom use cases.
   - Modify the `isOriginAllowed` function to enforce more complex origin policies if needed.

3. **Leverage Heartbeat Utilities**: Use the re-exported heartbeat utilities from [heartbeat.ts](./src/heartbeat.ts) to add liveness checks or customize existing ones.

4. **Write Tests**: Ensure your changes are thoroughly tested. Add test cases to validate new features or modifications. Place your tests in the appropriate test files within the package.

5. **Follow Existing Patterns**: Maintain consistency with the existing codebase by adhering to the patterns and conventions used in the package.

By following these steps, you can effectively extend the `websocket-channel-server` package to meet your specific requirements while maintaining compatibility with the broader TypeAgent ecosystem.

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

_Auto-generated against commit `6bea19a9ee02598644b1ac3ab67c705dcc495832` on `2026-07-22T11:19:17.632Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter websocket-channel-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
