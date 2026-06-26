<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=1b436dfa6bfe917816344e5cd1de11c7b87d66b71d0ad5e3c0ee3dc79acf4e51 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vscode-chat — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `vscode-chat` package registers TypeAgent as a third-party agent in Visual Studio Code's native Chat view. This integration allows users to interact with TypeAgent sessions directly within VS Code, leveraging the proposed `chatSessionsProvider` API. Conversations initiated through this extension, the Electron shell, the CLI, or `vscode-shell` appear as session items in the Chat sidebar, and prompts sent in these sessions are routed through the running agent server.

## What it does

The `vscode-chat` package enables TypeAgent to function as a chat provider within VS Code's Chat view. It supports the following capabilities:

- **Session Management**: Users can view and manage TypeAgent sessions directly from the Chat sidebar. Existing sessions can be selected, and new sessions can be created using the `+` button.
- **Prompt Handling**: Prompts typed into the chat are processed by the TypeAgent dispatcher, and the responses are displayed in the chat panel.
- **Integration with Agent Server**: The extension connects to a running TypeAgent agent server, typically reachable at `ws://localhost:8999`, to handle the communication and processing of chat prompts.
- **Display Rendering**: The package includes functionality to render chat responses in markdown and text formats, ensuring that the output is appropriately formatted for display in the chat panel.

## Setup

To set up the `vscode-chat` extension, follow these steps:

1. **Prerequisites**:

   - Ensure you have Visual Studio Code version 1.95 or newer. The Insiders build is recommended for access to proposed APIs.
   - Start the TypeAgent agent server, which should be reachable at `ws://localhost:8999`. You can start the server from the TypeAgent monorepo with the following commands:
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
     Alternatively, you can set the `enable-proposed-api` flag in your Insiders launch configuration.

## Key Files

The `vscode-chat` package consists of several key files that manage different aspects of the extension:

- **[displayRender.ts](./src/displayRender.ts)**: Contains functions to render chat responses in markdown and text formats. It uses the `ansi_up` library to convert ANSI text to HTML.
- **[extension.ts](./src/extension.ts)**: The main entry point for the extension. It handles the connection to the agent server, session management, and registration of VS Code commands.
- **[sessionManager.ts](./src/sessionManager.ts)**: Manages the chat sessions, including the creation, updating, and deletion of sessions. It interacts with the agent server to process prompts and receive responses.
- **[vscode.proposed.chatSessionsProvider.d.ts](./src/vscode.proposed.chatSessionsProvider.d.ts)**: Type definitions for the proposed `chatSessionsProvider` API, which is used to integrate TypeAgent with VS Code's Chat view.

## How to extend

To extend the `vscode-chat` package, follow these steps:

1. **Start with the main entry point**: Open [extension.ts](./src/extension.ts). This file contains the initialization logic for the extension and is a good starting point for understanding how the extension works.
2. **Modify session management**: If you need to change how sessions are managed, look into [sessionManager.ts](./src/sessionManager.ts). This file handles the creation, updating, and deletion of chat sessions.
3. **Update display rendering**: To change how chat responses are rendered, edit [displayRender.ts](./src/displayRender.ts). This file contains functions for converting responses to markdown and text formats.
4. **Test your changes**: Run the following scripts to compile and deploy your changes locally:
   ```sh
   npm run compile
   npm run deploy:local
   ```
   Launch VS Code with the proposed API enabled to test your modifications.

By following these steps, you can effectively extend the functionality of the `vscode-chat` package to meet your specific requirements.

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

`./src/displayRender.ts`, `./src/extension.ts`, `./src/sessionManager.ts`, …and 1 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vscode-chat docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
