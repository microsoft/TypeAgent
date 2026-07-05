<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=302b3f018e8404d2a46fd886094a4d86ed1051f538998ebdc6ce6e60ee06de1a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vscode-shell — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `vscode-shell` package integrates the TypeAgent shell chat into Visual Studio Code, providing a side panel and editor tabs for interacting with TypeAgent conversations. Each chat panel is backed by a TypeAgent conversation hosted by a running TypeAgent agent server.

## What it does

This package allows users to interact with TypeAgent conversations directly within the Visual Studio Code environment. Key features include:

- **Activity Bar Integration**: A dedicated icon in the activity bar opens the persistent **Chat** side panel.
- **Editor Tabs for Chats**: Users can open multiple chat tabs in the editor, each representing a separate conversation.
- **Command Palette Commands**: Commands under the "TypeAgent" category include `Open Chat in Editor`, `New Chat (Side Panel)`, `Focus Chat`, `New Conversation`, `Switch Conversation`, `Rename Conversation`, `Delete Conversation`, and `Clear Chat View`.
- **IntelliSense Support**: Inline ghost text suggestions and dropdown menus assist with command completions.
- **Conversation Management**: Users can create, rename, switch, and delete conversations using either slash commands (e.g., `@conversation new [name]`) or natural language inputs (e.g., "create a new conversation called Brainstorm").
- **Request Management**: Users can cancel in-progress or queued requests directly from the chat interface, with clear visual indicators for request status.

Additionally, the extension supports a `vscode-shell-action` client action, which can be enabled or disabled per session using the `@config schema` command.

## Setup

To use the `vscode-shell` package, ensure the following prerequisites are met:

1. **Visual Studio Code**: Version 1.90 or newer is required.
2. **TypeAgent Agent Server**: A running instance of the TypeAgent agent server is needed, accessible at `ws://localhost:8999` by default.

To start the agent server:

```sh
cd ts/packages/agentServer/server
pnpm run start
```

The agent server requires the rest of the TypeAgent stack to be built. Refer to the top-level TypeAgent README for detailed setup instructions.

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

The `vscode-shell` package is organized into several key components, each responsible for specific functionality:

- **[agentServerBridge.ts](./src/agentServerBridge.ts)**: Manages the WebSocket connection to the agent server and bridges messages between the extension host and the webview panels.
- **[clientIO.ts](./src/bridge/clientIO.ts)**: Implements the `ClientIO` interface, forwarding calls to the webview and handling request IDs for cancellation and message routing.
- **[main.ts](./src/webview/main.ts)**: The entry point for the webview, responsible for rendering the chat interface within VS Code.
- **[chatViewProvider.ts](./src/chatViewProvider.ts)**: Provides the chat webview for the sidebar and manages the creation of editor panels for individual chat sessions.
- **[extension.ts](./src/extension.ts)**: Contains the activation logic for the extension, including setting up commands, keybindings, and the status bar integration.

These files work together to provide a cohesive experience for interacting with TypeAgent conversations in VS Code.

## How to extend

To extend the functionality of the `vscode-shell` package, follow these steps:

1. **Understand the Extension Host**:

   - Start by reviewing [agentServerBridge.ts](./src/agentServerBridge.ts) to understand how the WebSocket connection to the agent server is established and how messages are handled.

2. **Modify the Webview UI**:

   - If you need to change the chat interface, begin with [main.ts](./src/webview/main.ts). This file is the main entry point for the webview and contains the logic for rendering the chat UI.

3. **Add or Modify Commands**:

   - To introduce new commands or modify existing ones, update [extension.ts](./src/extension.ts). This file is responsible for registering commands and keybindings.
   - If the new functionality involves the chat interface, you may also need to update [chatViewProvider.ts](./src/chatViewProvider.ts).

4. **Test Your Changes**:

   - Use the following commands to build and test your changes:
     ```sh
     npm run compile
     npm run watch
     ```
   - To test the extension in VS Code, use the `npm run deploy:local` command to install the updated extension locally.

5. **Extend Conversation Management**:

   - If you need to add or modify conversation management features, review the `manageConversation` and related methods in [agentServerBridge.ts](./src/agentServerBridge.ts). These methods handle actions like creating, switching, and deleting conversations.

6. **Update the Bridge**:
   - For changes related to message routing or request handling, examine [clientIO.ts](./src/bridge/clientIO.ts) and [messages.ts](./src/bridge/messages.ts). These files define the communication protocol between the extension host and the webview.

By following these guidelines, you can effectively extend and customize the `vscode-shell` package to suit your needs. Be sure to test your changes thoroughly to ensure compatibility and functionality.

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

External: `ansi_up`, `debug`, `dompurify`, `isomorphic-ws`, `markdown-it`, `ws`

### Files of interest

`./src/webview/main.ts`, `./src/agentServerBridge.ts`, `./src/bridge/clientIO.ts`, …and 8 more under `./src/`.

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vscode-shell docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
