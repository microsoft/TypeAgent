<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f6f64c22a6b9021b678070b4a803e0ea5418f3e2b9cc2db91263b3d8041930cf -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# visualstudio-extension-webview — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `visualstudio-extension-webview` package provides the WebView2-based chat panel content for the Visual Studio TypeAgent extension. It integrates with the Visual Studio IDE to enable a chat interface that interacts with TypeAgent services, facilitating real-time communication and dynamic content display within the development environment.

This package is a TypeAgent application agent and relies on several TypeAgent components, including `@typeagent/agent-rpc`, `@typeagent/agent-sdk`, and `chat-ui`, to deliver its functionality.

## What it does

The `visualstudio-extension-webview` package powers the chat panel embedded in Visual Studio. It uses WebView2 to render the interface and connects to TypeAgent services to handle real-time interactions. Key capabilities include:

- **Displaying chat messages and dynamic content**: The chat panel renders messages and other content dynamically, using the `chat-ui` package for its interface.
- **Handling user input**: User messages are processed and sent to the dispatcher via the `handleUserMessage` function.
- **Fetching completions and dynamic display content**: The package supports actions like `getCompletions` and `getDynamicDisplay`, which retrieve suggestions and content updates from the dispatcher.
- **Connection management**: It manages the connection to the dispatcher, including reconnection logic and status updates.

The package interacts with other TypeAgent components to enable these features. For example, it uses `@typeagent/dispatcher-rpc` to communicate with the dispatcher and `@typeagent/agent-server-protocol` for server interactions.

## Setup

To use the `visualstudio-extension-webview` package, ensure the following environment variable is configured:

- `AGENT_SERVER_DEFAULT_URL`: This specifies the default URL for the agent server. The value should point to the server instance that the chat panel will connect to.

For detailed instructions on obtaining and configuring this variable, refer to the hand-written README.

## Key Files

The package's functionality is implemented across three primary files:

### [main.ts](./src/main.ts)

This is the entry point of the package. It initializes the chat panel and sets up the connection to the dispatcher. Key responsibilities include:

- Creating the chat panel UI using the `ChatPanel` class from the `chat-ui` package.
- Handling user interactions, such as sending messages and fetching completions.
- Managing the connection banner to indicate the connection status.

The `initialize` function in this file sets up the chat panel and its event handlers. It also manages the lifecycle of the dispatcher connection through the `dispatcherHandle` object.

### [dispatcherConnection.ts](./src/dispatcherConnection.ts)

This file manages the connection to the dispatcher. It is responsible for:

- Establishing and maintaining the connection to the dispatcher using `@typeagent/dispatcher-rpc`.
- Creating RPC servers and clients for communication.
- Handling connection changes and implementing reconnection logic.

The `connectDispatcher` function is the main entry point for setting up the dispatcher connection. It uses the `createDispatcherRpcClient` and `createClientIORpcServer` utilities to establish communication channels.

### [platformAdapter.ts](./src/platformAdapter.ts)

This file provides platform-specific adaptations for the WebView2 environment. Its primary role is to bridge the gap between the web-based chat panel and the Visual Studio host. Key functionalities include:

- Handling link clicks within the chat panel. Links are posted to the host using `window.chrome.webview.postMessage`, which allows the Visual Studio environment to open them in the default browser.
- Providing a fallback mechanism for development environments where WebView2 is not available.

The `vsPlatformAdapter` object implements the `PlatformAdapter` interface from the `chat-ui` package.

## How to extend

To extend the `visualstudio-extension-webview` package, follow these steps:

1. **Start with `main.ts`**:

   - This file is the entry point for the package. To add new features, modify the initialization logic or extend the event handlers in this file.
   - For example, you can add new UI elements to the chat panel or implement additional user interaction handlers.

2. **Modify `dispatcherConnection.ts`**:

   - If your changes involve new interactions with the dispatcher, update this file. You can add new RPC methods or modify the existing connection logic.
   - For instance, you might implement a new action that retrieves additional data from the dispatcher.

3. **Update `platformAdapter.ts`**:

   - For platform-specific changes, such as handling new types of messages or interactions, update the `vsPlatformAdapter` object.
   - This is particularly useful if you need to extend the communication between the WebView2 panel and the Visual Studio host.

4. **Test your changes**:
   - Run the package in the Visual Studio environment to verify your modifications. Use the built-in testing tools to ensure that the new functionality works as expected.

By following these steps, you can effectively extend and customize the `visualstudio-extension-webview` package to meet specific requirements.

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
- [@typeagent/dispatcher-types](../../../../../packages/dispatcher/types/README.md)
- [chat-ui](../../../../../packages/chat-ui/README.md)

External: _None at runtime._

### Files of interest

`./src/main.ts`, `./src/dispatcherConnection.ts`, `./src/platformAdapter.ts`.

---

_Auto-generated against commit `8f591da77983db53fd4a3e0ca12b58d80aaa3628` on `2026-07-22T20:55:48.144Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter visualstudio-extension-webview docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
