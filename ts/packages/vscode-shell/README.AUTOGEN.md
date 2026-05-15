<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b800117a361146a8eb183ba1e59e3308aadcc05195780031e639bbcab29e6593 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vscode-shell — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `vscode-shell` package embeds the TypeAgent shell chat directly into Visual Studio Code, providing a side panel and editor tabs for interacting with TypeAgent conversations. Each chat panel is backed by a TypeAgent conversation hosted by the running TypeAgent agent server.

## What it does

The `vscode-shell` package integrates TypeAgent's chat functionality into VS Code, allowing users to open and manage conversations directly within the editor. It supports various actions such as `newConversation`, `renameConversation`, `switchConversation`, and `deleteConversation`. Users can interact with the chat through the activity bar icon, keyboard shortcuts, and command palette commands. The package also provides IntelliSense features like inline ghost text and dropdown menus for command completions.

### Key Features

- **Activity Bar Integration**: Opens the persistent **Chat** side panel.
- **Editor Tabs**: Allows multiple chat tabs, each representing a separate conversation.
- **Command Palette**: Provides commands for managing conversations, such as `Open Chat in Editor`, `New Chat (Side Panel)`, `Focus Chat`, `New Conversation`, `Switch Conversation`, `Rename Conversation`, `Delete Conversation`, and `Clear Chat View`.
- **IntelliSense**: Offers inline ghost text and dropdown menus for command completions.
- **Conversation Management**: Supports chat-driven commands to manage conversations, such as creating, renaming, switching, and deleting conversations.

## Setup

To set up the `vscode-shell` package, ensure you have the following prerequisites:

- Visual Studio Code version 1.90 or newer.
- A running TypeAgent agent server reachable on `ws://localhost:8999`.

Start the agent server from the TypeAgent monorepo:

```sh
cd ts/packages/agentServer/server
pnpm run start
```

The agent server depends on the rest of the TypeAgent stack being built. See the top-level TypeAgent README for setup.

### Installation

#### Build & install locally (recommended for development)

From the `vscode-shell` directory:

```sh
npm install
npm run deploy:local
```

`deploy:local` packages the extension and installs it into your active `code` CLI in one step. Reload the VS Code window after the first install.

To uninstall a previous version (e.g. the legacy `typeagent-shell` package):

```sh
code --uninstall-extension typeagent.typeagent-shell
```

#### Install a prebuilt VSIX

```sh
npm run package
code --install-extension dist-pub/vscode-shell.vsix --force
```

## Key Files
The `vscode-shell` package consists of several key components:

- **Extension Host**: Manages the WebSocket connection to the agent server and bridges messages to/from webview panels. Key files include [agentServerBridge.ts](./src/agentServerBridge.ts) and [clientIO.ts](./src/bridge/clientIO.ts).
- **Webview UI**: Provides the chat interface within VS Code. The main entry point is [main.ts](./src/webview/main.ts).
- **Chat View Provider**: Handles the creation and management of webview panels for the chat interface. See [chatViewProvider.ts](./src/chatViewProvider.ts).
- **Extension Activation**: Initializes the extension and sets up the necessary commands and keybindings. See [extension.ts](./src/extension.ts).

### Key Files and Their Responsibilities

- **[agentServerBridge.ts](./src/agentServerBridge.ts)**: Manages the RPC connection to the agent server from the extension host and bridges messages to/from webview panels.
- **[clientIO.ts](./src/bridge/clientIO.ts)**: Implements the ClientIO interface that forwards calls to the webview.
- **[chatViewProvider.ts](./src/chatViewProvider.ts)**: Provides the chat webview for the sidebar and helper for editor panels.
- **[extension.ts](./src/extension.ts)**: Contains the activation logic for the extension, setting up commands and keybindings.

## How to extend

To extend the `vscode-shell` package, follow these steps:

1. **Start with the Extension Host**: Open [agentServerBridge.ts](./src/agentServerBridge.ts) to understand how the WebSocket connection and message handling are implemented.
2. **Modify the Webview UI**: If you need to change the chat interface, start with [main.ts](./src/webview/main.ts).
3. **Add New Commands**: To add new commands or keybindings, modify [extension.ts](./src/extension.ts) and [chatViewProvider.ts](./src/chatViewProvider.ts).
4. **Testing**: Run `npm run compile` and `npm run watch` to build and test your changes. Use `npm run deploy:local` to install the extension locally and verify its functionality in VS Code.

By following these steps, you can effectively extend the functionality of the `vscode-shell` package to meet your specific needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/extension.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../packages/agentServer/protocol/README.md)
- [@typeagent/completion-ui](../../packages/completionUI/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [chat-ui](../../packages/chat-ui/README.md)

External: `ansi_up`, `debug`, `dompurify`, `isomorphic-ws`, `markdown-it`, `ws`

### Files of interest

`./src/webview/main.ts`, `./src/agentServerBridge.ts`, `./src/bridge/clientIO.ts`, …and 8 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:30.178Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vscode-shell docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
