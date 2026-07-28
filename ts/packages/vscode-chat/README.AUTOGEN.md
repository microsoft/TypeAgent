<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=0f2ddce4680048309de9e8bb47fec0ce87c5e7557e3d84ce83aba04d56b767bc -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vscode-chat — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `vscode-chat` package integrates TypeAgent as a third-party agent into Visual Studio Code's native Chat view. It uses the proposed `chatSessionsProvider` API to enable users to interact with TypeAgent sessions directly within VS Code. Conversations initiated through this extension, the Electron shell, the CLI, or `vscode-shell` are synchronized and appear as session items in the Chat sidebar. Prompts sent in these sessions are routed through a running TypeAgent agent server.

This extension is designed for use with the VS Code Insiders build and requires enabling proposed APIs. It is not eligible for the VS Code Marketplace while the `chatSessionsProvider` API remains in the proposed stage.

## What it does

The `vscode-chat` package provides the following capabilities:

- **Session Management**: Users can view, create, and manage TypeAgent sessions directly from the Chat sidebar. Existing sessions are displayed in the session list, and new sessions can be created using the `+` button in the Chat view.
- **Prompt Processing**: Prompts entered in the Chat view are sent to the TypeAgent dispatcher via the agent server. Responses are streamed back and displayed in the chat panel in markdown or plain text format.
- **Agent Server Integration**: The extension connects to a running TypeAgent agent server, typically at `ws://localhost:8999`, to handle communication and processing of chat prompts.
- **Cross-Platform Session Visibility**: Conversations created in the VS Code Chat view are accessible from other TypeAgent interfaces, such as the CLI and Electron shell.
- **Customizable Display**: Chat responses are rendered using markdown or plain text, with support for ANSI-to-HTML conversion for enhanced display.

## Setup

To set up and use the `vscode-chat` extension, follow these steps:

1. **Prerequisites**:

   - Install Visual Studio Code version 1.95 or newer. The Insiders build is recommended for access to proposed APIs.
   - Ensure a TypeAgent agent server is running and accessible at `ws://localhost:8999`. You can start the server from the TypeAgent monorepo:
     ```sh
     cd ts/packages/agentServer/server
     pnpm run start
     ```

2. **Installation**:

   - Install the extension dependencies and deploy it locally:
     ```sh
     npm install
     npm run deploy:local
     ```
   - Launch VS Code with the proposed API enabled:
     ```sh
     code-insiders --enable-proposed-api typeagent.vscode-chat
     ```
     Alternatively, configure the `enable-proposed-api` flag in your Insiders launch configuration.

3. **Configuration**:
   - The extension uses the `typeagentChat.serverUrl` setting to specify the WebSocket URL of the TypeAgent agent server. By default, this is set to `ws://localhost:8999`. Update this setting in your VS Code configuration if your agent server is running on a different URL.

## Key Files

The `vscode-chat` package is organized into several key files, each responsible for specific functionality:

- **[extension.ts](./src/extension.ts)**: The main entry point for the extension. It initializes the connection to the agent server, registers VS Code commands, and integrates with the `chatSessionsProvider` API.
- **[sessionManager.ts](./src/sessionManager.ts)**: Manages the lifecycle of chat sessions, including creating, updating, and deleting sessions. It handles communication with the agent server to process prompts and receive responses.
- **[displayRender.ts](./src/displayRender.ts)**: Handles the rendering of chat responses in markdown and plain text formats. It uses the `ansi_up` library to convert ANSI text to HTML for display in the Chat view.
- **[connectionHolder.ts](./src/connectionHolder.ts)**: Manages the connection to the agent server, ensuring that prompts submitted while disconnected are queued and processed once a connection is re-established.
- **[vscode.proposed.chatSessionsProvider.d.ts](./src/vscode.proposed.chatSessionsProvider.d.ts)**: Provides type definitions for the proposed `chatSessionsProvider` API, which is used to integrate TypeAgent with VS Code's Chat view.

## How to extend

To extend the functionality of the `vscode-chat` package, follow these steps:

1. **Understand the entry point**:

   - Start with [extension.ts](./src/extension.ts), which contains the initialization logic for the extension. This file is the central hub for connecting the agent server, managing sessions, and registering commands.

2. **Modify session management**:

   - To customize how chat sessions are handled, explore [sessionManager.ts](./src/sessionManager.ts). This file manages session creation, updates, and deletion, and handles communication with the agent server.

3. **Customize display rendering**:

   - If you need to change how chat responses are displayed, edit [displayRender.ts](./src/displayRender.ts). This file contains the logic for rendering responses in markdown and plain text formats.

4. **Enhance connection handling**:

   - To modify how the extension handles connections to the agent server, review [connectionHolder.ts](./src/connectionHolder.ts). This file ensures that prompts submitted while disconnected are queued and processed once a connection is re-established.

5. **Add new commands or features**:

   - To add new commands or extend existing functionality, modify [extension.ts](./src/extension.ts). You can register additional VS Code commands or enhance the integration with the `chatSessionsProvider` API.

6. **Test your changes**:

   - Use the following scripts to build and test your changes locally:
     ```sh
     npm run compile
     npm run deploy:local
     ```
   - Launch VS Code with the proposed API enabled to verify your modifications.

7. **Regenerate the icon font (if needed)**:
   - If you modify the `typeagent.svg` icon, regenerate the `typeagent-icons.woff` font using the `fantasticon` tool:
     ```sh
     npx --yes fantasticon
     ```
   - Update the extension version in `package.json` and reinstall the extension to ensure the new font is loaded.

By following these steps, you can effectively extend and customize the `vscode-chat` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/extension.cjs` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../packages/agentServer/protocol/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)

External: `ansi_up`, `debug`

### Files of interest

`./src/connectionHolder.ts`, `./src/displayRender.ts`, `./src/extension.ts`, …and 2 more under `./src/`.

---

_Auto-generated against commit `8f591da77983db53fd4a3e0ca12b58d80aaa3628` on `2026-07-22T20:55:48.144Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vscode-chat docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
