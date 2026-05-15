<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b10e9d486499d4bfd5645dcdaac1a3e5cfff930a717274c621466ac889513c0a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# websocket-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `websocket-utils` package provides utility functions for working with WebSockets in the TypeAgent project. It facilitates the creation and management of WebSocket connections, enabling communication between different components of the system.

## What it does

The package primarily handles the creation of WebSocket connections through the `createWebSocket` function. This function allows you to specify the channel, role, client ID, port, and session ID for the WebSocket connection. It reads the WebSocket host from the environment variable `WEBSOCKET_HOST` or from a `.env` file if the environment variable is not set. The package also defines the `WebSocketMessageV2` type, which structures the messages sent over the WebSocket.

## Setup

To use the `websocket-utils` package, you need to set the `WEBSOCKET_HOST` environment variable. This variable specifies the host for the WebSocket connection. You can set it directly in your environment or in a `.env` file located in your project directory.

1. Set the `WEBSOCKET_HOST` environment variable:
   - Directly in your shell:
     ```sh
     export WEBSOCKET_HOST="ws://your-websocket-host"
     ```
   - Or in a `.env` file:
     ```text
     WEBSOCKET_HOST=ws://your-websocket-host
     ```

For detailed setup instructions, see the hand-written README.

## Key Files
The package consists of the following key files:

- [index.ts](./src/index.ts): Exports the functions and types from `webSockets.ts`.
- [webSockets.ts](./src/webSockets.ts): Contains the main logic for creating WebSocket connections and defines the `WebSocketMessageV2` type.
- [tsconfig.json](./src/tsconfig.json): TypeScript configuration file that extends the base configuration and specifies compiler options.

The `createWebSocket` function in [webSockets.ts](./src/webSockets.ts) is the core of the package. It constructs the WebSocket endpoint using the provided parameters and environment variables, and returns a promise that resolves to a WebSocket instance.

## How to extend

To extend the `websocket-utils` package, follow these steps:

1. Open [webSockets.ts](./src/webSockets.ts) to understand the existing implementation of the `createWebSocket` function.
2. Add new functions or modify existing ones to support additional WebSocket features or configurations.
3. Ensure that any new environment variables or configurations are documented and handled appropriately.
4. Write tests for your new or modified functions to ensure they work as expected.

To run tests, use the following command:

```sh
pnpm test
```

By following these steps, you can extend the functionality of the `websocket-utils` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace: _None._

External: `debug`, `dotenv`, `find-config`, `isomorphic-ws`, `ws`

### Used by

- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [code-agent](../../../packages/agents/code/README.md)

### Files of interest

`./src/index.ts`, `./src/tsconfig.json`, `./src/webSockets.ts`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `WEBSOCKET_HOST`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter websocket-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
