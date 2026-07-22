<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=64bf1c607a43b00bcabebf7ffcf8af46af0d2498888c1f6576ff46ca3c7a14fb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-ui — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `chat-ui` package provides a shared, framework-free chat user interface for TypeAgent applications. It is designed to ensure a consistent and interactive chat experience across multiple platforms, including the VS Code shell extension, the browser extension chat panel, and the Visual Studio extension webview. The package includes components for rendering user and agent messages, handling streaming updates, replaying chat history, managing connection status, and collecting user feedback.

## What it does

The `chat-ui` package offers a set of tools and components to build and manage chat interfaces. Its primary features include:

- **ChatPanel**: The core component for rendering the chat interface. It supports:

  - Adding user and agent messages via `addAgentMessage`.
  - Updating display metadata with `setDisplayInfo`.
  - Replaying historical chat entries using `replayHistory`.
  - Streaming updates for dynamic content display.

- **FeedbackWidget**: A component for collecting user feedback, including thumbs-up/thumbs-down ratings, comments, and contextual information.

- **PartialCompletion**: Integrates with the `@typeagent/completion-ui` package to handle command completions, including input updates, acceptance, and dismissal.

- **Connection Status Management**: Provides a shared model and UI for displaying the connection status between the chat client and the server. This includes reconnect options and error handling.

- **PlatformAdapter**: Abstracts platform-specific behaviors, such as handling link clicks and settings, to ensure compatibility across different environments.

- **Shared Styles**: A CSS file (`styles/chat.css`) is included to provide a consistent appearance for the chat UI across all host applications.

The package is used by several TypeAgent components, such as the VS Code shell, the browser extension, and the Visual Studio extension webview, ensuring a unified user experience across these platforms.

## Setup

To integrate the `chat-ui` package into your project, follow these steps:

1. **Install the package**: Add `chat-ui` to your project dependencies using your preferred package manager.
2. **Install required dependencies**: Ensure the following workspace dependencies are installed:
   - `@typeagent/agent-sdk`
   - `@typeagent/completion-ui`
   - `@typeagent/dispatcher-types`
3. **Include styles**: Import the CSS file located at `styles/chat.css` into your project to apply the necessary styles for the chat UI.
4. **External libraries**: The package relies on the following external libraries:
   - `ansi_up` for processing ANSI escape codes.
   - `dompurify` for sanitizing HTML content.
   - `markdown-it` for rendering Markdown content.

For additional details on usage and integration, refer to the hand-written README.

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

To extend the `chat-ui` package, follow these steps:

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

- default → [./dist/index.js](./dist/index.js)
- `./styles` → [./styles/chat.css](./styles/chat.css)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/completion-ui](../../packages/completionUI/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)

External: `ansi_up`, `dompurify`, `markdown-it`

### Used by

- [@typeagent/browser-extension](../../packages/agents/browserExtension/README.md)
- [agent-shell](../../packages/shell/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- visualstudio-extension-webview
- [vscode-shell](../../packages/vscode-shell/README.md)

### Files of interest

`./src/index.ts`, `./src/chatPanel.ts`, `./src/connectionStatus.ts`, …and 13 more under `./src/`.

---

_Auto-generated against commit `0b06d6a1cc9d93888e91e217057d9c148b3cc49f` on `2026-07-22T04:45:01.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
