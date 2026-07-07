<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6a022a7933d64a9e5e3bec8053d32ce0f9482edc34e4bdf024f502cb0631f8fb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-ui — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `chat-ui` package provides a shared, framework-free chat user interface for TypeAgent applications, including the VS Code shell extension and the browser extension chat panel. It is designed to handle user and agent interactions, support streaming updates, manage chat history, and provide features like command completions, feedback collection, and connection status indicators. The package is built to be flexible and reusable across different host environments.

## What it does

The `chat-ui` package offers the following key features:

- **ChatPanel**: The core component for rendering the chat interface. It supports user input, agent messages, streaming updates, and history replay. Key methods include:
  - `addAgentMessage`: Adds a new message from the agent.
  - `setDisplayInfo`: Updates the display with metadata like source and action.
  - `replayHistory`: Replays a list of historical chat entries.
- **FeedbackWidget**: A component for collecting user feedback on chat interactions. It supports thumbs-up/thumbs-down ratings, comments, and context inclusion.
- **PartialCompletion**: Integrates with the `@typeagent/completion-ui` package to handle command completions, including input updates, acceptance, and dismissal.
- **Connection Status Management**: Provides a shared model and UI for displaying the connection status between the chat client and the server. It includes reconnect options and error handling.
- **PlatformAdapter**: Abstracts platform-specific behaviors, such as handling link clicks and settings, to ensure compatibility across different environments.
- **Shared Styles**: Includes a CSS file (`styles/chat.css`) to ensure a consistent appearance for the chat UI across all host applications.

The package is used by multiple TypeAgent components, such as the VS Code shell, the browser extension, and the Visual Studio extension webview.

## Setup

To use the `chat-ui` package in your project, follow these steps:

1. **Install the package**: Add `chat-ui` to your project dependencies using your package manager.
2. **Install required dependencies**: Ensure the following workspace dependencies are installed:
   - `@typeagent/agent-sdk`
   - `@typeagent/completion-ui`
   - `@typeagent/dispatcher-types`
3. **Include styles**: The package includes a CSS file located at `styles/chat.css`. You must include this file in your project's build process to ensure the chat UI is styled correctly.
4. **External libraries**: The package relies on the following external libraries:
   - `ansi_up` for processing ANSI escape codes.
   - `dompurify` for sanitizing HTML content.
   - `markdown-it` for rendering Markdown content.

Refer to the hand-written README for additional details on usage and integration.

## Key Files

The `chat-ui` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point, exporting the package's primary components and utilities.
- **[chatPanel.ts](./src/chatPanel.ts)**: Implements the `ChatPanel` component, which is the core of the chat UI. It handles user input, agent messages, and display updates.
- **[feedbackWidget.ts](./src/feedbackWidget.ts)**: Implements the `FeedbackWidget` component for collecting user feedback.
- **[partialCompletion.ts](./src/partialCompletion.ts)**: Manages command completions using the `@typeagent/completion-ui` package.
- **[connectionStatus.ts](./src/connectionStatus.ts)**: Defines the `ConnectionStatus` model and related utilities for managing and displaying connection status.
- **[platformAdapter.ts](./src/platformAdapter.ts)**: Provides an interface for handling platform-specific behaviors, such as link clicks and settings.
- **[styles/chat.css](./styles/chat.css)**: Contains shared CSS styles for the chat UI, ensuring a consistent look and feel across different hosts.

## How to extend

To extend the `chat-ui` package, follow these guidelines:

1. **Understand the core components**: Start by reviewing the [chatPanel.ts](./src/chatPanel.ts) file, as it contains the implementation of the `ChatPanel` component, which is central to the package's functionality.
2. **Add new features**: To introduce new features, modify or extend the relevant components. For example:
   - To add new user interactions, update the `ChatPanel` or `FeedbackWidget` components.
   - To support additional command completions, extend the `PartialCompletion` component.
3. **Update styles**: If your changes require visual updates, modify the [styles/chat.css](./styles/chat.css) file to ensure the new features are styled appropriately.
4. **Handle platform-specific needs**: If your changes involve platform-specific behaviors, update the [platformAdapter.ts](./src/platformAdapter.ts) file to include the necessary logic.
5. **Ensure content safety**: When adding or modifying HTML content, use the `setContent` utility or the `DOMPurify` library to sanitize the content and prevent security vulnerabilities.
6. **Test your changes**: Add or update tests to verify the functionality of your changes. Ensure that the package remains compatible with its existing integrations.

By following these steps, you can effectively extend the `chat-ui` package to meet your specific requirements while maintaining compatibility with the rest of the TypeAgent ecosystem.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
