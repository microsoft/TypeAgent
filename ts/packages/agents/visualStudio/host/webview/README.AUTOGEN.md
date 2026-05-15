<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=cfefbd5f7fa0ae98858289ce1af89ecce976be85d8f3543304c7dd5c8b0febec -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# visualstudio-extension-webview — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `visualstudio-extension-webview` package provides the WebView2 chat panel content for the Visual Studio TypeAgent extension. It integrates with the Visual Studio environment to offer a chat interface that interacts with TypeAgent services, enabling real-time communication and interaction within the IDE.

## What it does

This package enables a chat panel within Visual Studio using WebView2 technology. It connects to TypeAgent services to facilitate real-time communication and interaction. The main functionalities include:

- Displaying chat messages and dynamic content.
- Handling user input and sending messages (`handleUserMessage`).
- Fetching completions and dynamic display content from the dispatcher (`getCompletions`, `getDynamicDisplay`).
- Managing connection status and reconnection logic.

The package interacts with several other TypeAgent components, including `@typeagent/agent-rpc`, `@typeagent/agent-sdk`, `@typeagent/agent-server-protocol`, `@typeagent/dispatcher-rpc`, and `chat-ui`.

## Setup

To set up the `visualstudio-extension-webview` package, ensure you have the necessary environment variables and dependencies configured. The key environment variable is:

- `AGENT_SERVER_DEFAULT_URL`: The default URL for the agent server.

For detailed setup instructions, including how to obtain and configure this environment variable, refer to the hand-written README.

## Key Files
The package's architecture is centered around three main files:

- [main.ts](./src/main.ts): Initializes the chat panel and manages the connection to the dispatcher. It sets up the UI elements and handles user interactions.
- [dispatcherConnection.ts](./src/dispatcherConnection.ts): Manages the connection to the dispatcher, including creating RPC servers and clients, and handling connection changes.
- [platformAdapter.ts](./src/platformAdapter.ts): Provides platform-specific adaptations for WebView2, such as handling link clicks and posting messages to the host.

### main.ts

The [main.ts](./src/main.ts) file is the entry point for the package. It initializes the chat panel using the `ChatPanel` class from the `chat-ui` package and sets up the connection to the dispatcher. It also handles user interactions, such as sending messages and fetching completions.

### dispatcherConnection.ts

The [dispatcherConnection.ts](./src/dispatcherConnection.ts) file manages the connection to the dispatcher. It creates RPC servers and clients using the `@typeagent/agent-rpc` and `@typeagent/dispatcher-rpc` packages. It also handles connection changes and reconnection logic.

### platformAdapter.ts

The [platformAdapter.ts](./src/platformAdapter.ts) file provides platform-specific adaptations for WebView2. It handles link clicks and posts messages to the host using `window.chrome.webview.postMessage`. This allows the chat panel to interact with the Visual Studio environment.

## How to extend

To extend the functionality of the `visualstudio-extension-webview` package, follow these steps:

1. **Start with `main.ts`**: This file is the entry point for initializing the chat panel. You can add new features or modify existing ones by updating the initialization logic and event handlers.

2. **Modify `dispatcherConnection.ts`**: If you need to change how the package interacts with the dispatcher, this is the file to edit. You can add new RPC methods or modify the connection handling logic.

3. **Update `platformAdapter.ts`**: For platform-specific changes, such as handling new types of messages or interactions, update the platform adapter.

4. **Test your changes**: Ensure that your modifications are working correctly by running the package in the Visual Studio environment. You can use the built-in testing tools to verify functionality.

By following these steps, you can effectively extend and customize the `visualstudio-extension-webview` package to meet your needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../../../packages/agentSdk/README.md)
- [@typeagent/agent-server-protocol](../../../../../packages/agentServer/protocol/README.md)
- [@typeagent/dispatcher-rpc](../../../../../packages/dispatcher/rpc/README.md)
- [chat-ui](../../../../../packages/chat-ui/README.md)

External: _None at runtime._

### Files of interest

`./src/main.ts`, `./src/dispatcherConnection.ts`, `./src/platformAdapter.ts`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:26.515Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter visualstudio-extension-webview docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
