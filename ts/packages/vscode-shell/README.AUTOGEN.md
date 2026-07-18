<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=bf35ec5679ba5d1f6ff1c6025fad8d84175b5c0e42dc126bb612812e43472182 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vscode-shell — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `vscode-shell` package integrates the TypeAgent shell chat into Visual Studio Code, allowing users to interact with TypeAgent conversations directly within the editor. It provides a dedicated side panel and editor tabs for managing conversations hosted by a running TypeAgent agent server.

## What it does

The `vscode-shell` package provides a comprehensive chat interface within Visual Studio Code, enabling users to interact with the TypeAgent ecosystem. Key features include:

- **Chat Interface**:

  - A **Chat** side panel accessible from the activity bar.
  - Support for multiple chat tabs in the editor, each representing a separate conversation.

- **Command Palette Integration**:

  - Commands under the "TypeAgent" category, such as `Open Chat in Editor`, `New Chat (Side Panel)`, `Focus Chat`, `New Conversation`, `Switch Conversation`, `Rename Conversation`, `Delete Conversation`, and `Clear Chat View`.

- **Conversation Management**:

  - Manage conversations using slash commands (e.g., `@conversation new [name]`) or natural language inputs (e.g., "create a new conversation called Brainstorm").
  - Conversations are automatically restored on reload, with a default conversation named `"VS Code"` created for new agent server connections.

- **Request Management**:

  - Cancel in-progress or queued requests directly from the chat interface, with clear visual indicators for request status (e.g., `queued`, `running`, `cancelled`).

- **IntelliSense Support**:

  - Inline ghost text suggestions and dropdown menus for command completions.

- **Ephemeral Conversations**:

  - Editor-tab chat panels create ephemeral conversations that are automatically cleaned up by the server on restart.

- **Custom Client Action**:
  - Implements a `vscode-shell-action` client action, which can be enabled or disabled per session using the `@config schema` command.

## Setup

To use the `vscode-shell` package, ensure the following prerequisites are met:

1. **Visual Studio Code**: Version 1.90 or newer is required.
2. **TypeAgent Agent Server**: A running instance of the TypeAgent agent server is needed, accessible at `ws://localhost:8999` by default.

### Starting the Agent Server

To start the agent server, navigate to the server directory and run:

```sh
cd ts/packages/agentServer/server
pnpm run start
```

The agent server depends on the rest of the TypeAgent stack being built. Refer to the top-level TypeAgent README for detailed setup instructions.

### Installation

#### Build & Install Locally (Recommended for Development)

From the `vscode-shell` directory:

```sh
npm install
npm run deploy:local
```

This command packages the extension and installs it into your active `code` CLI in one step. After the first installation, reload the VS Code window.

To remove a previously installed version (e.g., the legacy `typeagent-shell` package):

```sh
code --uninstall-extension typeagent.typeagent-shell
```

#### Install a Prebuilt VSIX

Alternatively, you can install a prebuilt VSIX package:

```sh
npm run package
code --install-extension dist-pub/vscode-shell.vsix --force
```

## Key Files

The `vscode-shell` package is organized into several key components:

- **[agentServerBridge.ts](./src/agentServerBridge.ts)**: Manages the WebSocket connection to the agent server and bridges messages between the extension host and the webview panels. It also handles conversation management and request routing.
- **[clientIO.ts](./src/bridge/clientIO.ts)**: Implements the `ClientIO` interface, forwarding calls to the webview and managing request IDs for cancellation and message routing.
- **[main.ts](./src/webview/main.ts)**: The entry point for the webview, responsible for rendering the chat interface within VS Code.
- **[chatViewProvider.ts](./src/chatViewProvider.ts)**: Provides the chat webview for the sidebar and manages the creation of editor panels for individual chat sessions.
- **[extension.ts](./src/extension.ts)**: Contains the activation logic for the extension, including setting up commands, keybindings, and the status bar integration.
- **[messages.ts](./src/bridge/messages.ts)**: Defines the communication protocol between the extension host and the webview.
- **[requestIds.ts](./src/bridge/requestIds.ts)**: Handles the mapping of request IDs between the client and server for proper routing and cancellation.

These files collectively implement the core functionality of the extension, from establishing server connections to rendering the user interface and managing conversations.

## How to extend

To extend the `vscode-shell` package, follow these steps:

1. **Understand the Architecture**:

   - Start by reviewing [agentServerBridge.ts](./src/agentServerBridge.ts) to understand how the WebSocket connection to the agent server is established and how messages are handled.

2. **Modify the Webview UI**:

   - To change the chat interface, begin with [main.ts](./src/webview/main.ts). This file is the main entry point for the webview and contains the logic for rendering the chat UI.

3. **Add or Modify Commands**:

   - To introduce new commands or modify existing ones, update [extension.ts](./src/extension.ts). This file is responsible for registering commands and keybindings.
   - If the new functionality involves the chat interface, you may also need to update [chatViewProvider.ts](./src/chatViewProvider.ts).

4. **Enhance Conversation Management**:

   - To add or modify conversation management features, review the `manageConversation` and related methods in [agentServerBridge.ts](./src/agentServerBridge.ts). These methods handle actions like creating, switching, and deleting conversations.

5. **Update the Bridge**:

   - For changes related to message routing or request handling, examine [clientIO.ts](./src/bridge/clientIO.ts) and [messages.ts](./src/bridge/messages.ts). These files define the communication protocol between the extension host and the webview.

6. **Test Your Changes**:
   - Use the following commands to build and test your changes:
     ```sh
     npm run compile
     npm run watch
     ```
   - To test the extension in VS Code, use the `npm run deploy:local` command to install the updated extension locally.

By following these steps, you can effectively extend and customize the `vscode-shell` package to meet your specific requirements. Be sure to test your changes thoroughly to ensure compatibility and functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/extension.cjs` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../packages/agentServer/protocol/README.md)
- [@typeagent/completion-ui](../../packages/completionUI/README.md)
- [@typeagent/core](../../packages/typeagent-core/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- [@typeagent/websocket-utils](../../packages/utils/webSocketUtils/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [chat-ui](../../packages/chat-ui/README.md)

External: `ansi_up`, `debug`, `dompurify`, `isomorphic-ws`, `markdown-it`, `microsoft-cognitiveservices-speech-sdk`, `ws`

### Files of interest

`./src/webview/main.ts`, `./src/agentServerBridge.ts`, `./src/bridge/clientIO.ts`, …and 11 more under `./src/`.

---

_Auto-generated against commit `5cbcf613f047f08749d0451296eb1cdc610ae414` on `2026-07-17T18:24:18.404Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vscode-shell docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
