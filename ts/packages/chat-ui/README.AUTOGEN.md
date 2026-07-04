<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=0f5a5f8a999718b2894cf4359d93f82bd73a5ce9838bbabfa5a4c2ce69e56760 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-ui — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `chat-ui` package provides a shared, framework-free, DOM-based chat rendering solution for TypeAgent surfaces. It is used by the VS Code shell extension, the browser extension chat panel, and other TypeAgent hosts. The package includes components and utilities for rendering user and agent messages, handling streaming updates, replaying chat history, managing command completions, and displaying dynamic status and feedback.

## What it does

The `chat-ui` package is designed to provide a consistent and customizable chat interface for various TypeAgent hosts. Its primary features include:

- **ChatPanel**: The main component for rendering the chat interface. It supports user input, agent messages, streaming updates, and history replay. Hosts can use actions like `addAgentMessage`, `setDisplayInfo`, and `replayHistory` to interact with the chat panel.
- **FeedbackWidget**: A component for collecting user feedback on interactions within the chat interface. It supports feedback submission and UI management.
- **PartialCompletion**: Integrates with the `@typeagent/completion-ui` package to provide command completions. It handles input updates, completion suggestions, and user selection.
- **PlatformAdapter**: Provides an abstraction layer for platform-specific behaviors, such as handling link clicks and settings, enabling the chat UI to work across different environments like Electron and Chrome extensions.
- **Connection Status Management**: Includes utilities for rendering and managing the agent-server connection status, including reconnect options and error handling.
- **Shared Styles**: The package includes a CSS file (`styles/chat.css`) to ensure a consistent visual appearance across all hosts.

The package also includes built-in support for sanitizing HTML content using `DOMPurify`, ensuring safe rendering of dynamic content.

## Setup

To use the `chat-ui` package, follow these steps:

1. **Install the package**: Add the `chat-ui` package to your project using your package manager. For example, with `pnpm`:

   ```sh
   pnpm install chat-ui
   ```

2. **Install dependencies**: Ensure the following workspace dependencies are installed:

   - `@typeagent/agent-sdk`
   - `@typeagent/completion-ui`
   - `@typeagent/dispatcher-types`

   Additionally, the package relies on the following external dependencies:

   - `ansi_up`
   - `dompurify`
   - `markdown-it`

3. **Include styles**: Import the shared CSS styles in your project:

   ```ts
   import "chat-ui/styles";
   ```

4. **Initialize the ChatPanel**: Use the `ChatPanel` component in your host application. Refer to the example in the hand-written README for initialization details.

For further setup details, including any additional configuration, refer to the hand-written README.

## Key Files

The `chat-ui` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting all public components, utilities, and types.
- **[chatPanel.ts](./src/chatPanel.ts)**: Implements the `ChatPanel` component, which is the core of the chat UI. It handles user input, agent messages, and dynamic updates.
- **[feedbackWidget.ts](./src/feedbackWidget.ts)**: Defines the `FeedbackWidget` component for collecting and managing user feedback.
- **[partialCompletion.ts](./src/partialCompletion.ts)**: Manages command completions using the `@typeagent/completion-ui` package.
- **[platformAdapter.ts](./src/platformAdapter.ts)**: Provides the `PlatformAdapter` interface for handling platform-specific behaviors.
- **[setContent.ts](./src/setContent.ts)**: Contains utility functions for processing and sanitizing content before rendering.
- **[connectionStatus.ts](./src/connectionStatus.ts)**: Manages the agent-server connection status and provides utilities for rendering connection-related UI elements.
- **[contextMenu.ts](./src/contextMenu.ts)**: Implements a lightweight context menu for copy/paste functionality in the chat interface.
- **[styles/chat.css](./styles/chat.css)**: Provides shared CSS styles for the chat UI, ensuring a consistent look and feel across different hosts.

## How to extend

To extend the `chat-ui` package, follow these steps:

1. **Understand the core component**: Start by reviewing the [chatPanel.ts](./src/chatPanel.ts) file, which implements the `ChatPanel` component. This is the central part of the chat UI and is responsible for rendering messages, handling user input, and managing updates.

2. **Add new features**: To introduce new functionality, you can extend the `ChatPanel` or other components. For example:

   - To add new message types, modify the `addAgentMessage` or `setDisplayInfo` methods in `chatPanel.ts`.
   - To enhance feedback collection, extend the `FeedbackWidget` in [feedbackWidget.ts](./src/feedbackWidget.ts).

3. **Customize styles**: If you need to adjust the appearance of the chat UI, edit the [styles/chat.css](./styles/chat.css) file. Ensure that your changes align with the overall design language of the TypeAgent ecosystem.

4. **Handle platform-specific needs**: If your host application requires platform-specific behavior, extend the [platformAdapter.ts](./src/platformAdapter.ts) file. This file provides an abstraction layer for handling platform-specific features like link clicks and settings.

5. **Test your changes**: After making modifications, test your changes thoroughly. Add or update tests to ensure that your new features work as intended and do not introduce regressions.

By following these steps, you can effectively customize and extend the `chat-ui` package to meet the needs of your specific TypeAgent host application. For additional guidance, consult the hand-written README.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- `./styles` → [./styles/chat.css](./styles/chat.css)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/completion-ui](../../packages/completionUI/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)

External: `ansi_up`, `dompurify`, `markdown-it`

### Used by

- [agent-shell](../../packages/shell/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- visualstudio-extension-webview
- [vscode-shell](../../packages/vscode-shell/README.md)

### Files of interest

`./src/index.ts`, `./src/chatPanel.ts`, `./src/connectionStatus.ts`, …and 10 more under `./src/`.

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
