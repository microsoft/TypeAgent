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

The `chat-ui` package is designed to provide a consistent and customizable chat interface for various TypeAgent hosts. Its primary component, `ChatPanel`, serves as the core of the chat UI, offering the following capabilities:

- **Rendering chat messages**: Display user and agent messages in a structured format, including support for streaming updates.
- **Dynamic status updates**: Show connection status, error messages, and manual recovery options using the `ConnectionStatus` model.
- **History replay**: Load and display previously saved chat history.
- **Command completions**: Integrate with the `@typeagent/completion-ui` package to provide real-time command suggestions.
- **Feedback collection**: Use the `FeedbackWidget` to gather user feedback on interactions within the chat interface.
- **Customizable avatars**: Hosts can use the built-in `DEFAULT_AVATAR_MAP` or override it with their own avatar mappings.
- **Content sanitization**: All HTML content is sanitized using DOMPurify to ensure security.

The package also includes shared CSS styles to maintain a consistent appearance across different platforms and hosts.

## Setup

To use the `chat-ui` package, follow these steps:

1. **Install the package**: Add `chat-ui` to your project using your package manager.
2. **Install dependencies**: Ensure the following workspace dependencies are installed:
   - `@typeagent/agent-sdk`
   - `@typeagent/completion-ui`
   - `@typeagent/dispatcher-types`
3. **Include styles**: Import the shared CSS styles from `chat-ui/styles` into your project. These styles are required for the proper rendering of the chat UI.
4. **External dependencies**: The package relies on `ansi_up`, `dompurify`, and `markdown-it`. Ensure these dependencies are available in your project.

For additional setup details, refer to the hand-written README.

## Key Files

The `chat-ui` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting all public components, utilities, and types.
- **[chatPanel.ts](./src/chatPanel.ts)**: Implements the `ChatPanel` component, which is the core of the chat UI. It handles user input, agent messages, streaming updates, and history replay.
- **[feedbackWidget.ts](./src/feedbackWidget.ts)**: Provides the `FeedbackWidget` component for collecting user feedback on chat interactions.
- **[partialCompletion.ts](./src/partialCompletion.ts)**: Manages command completions by integrating with the `@typeagent/completion-ui` package.
- **[platformAdapter.ts](./src/platformAdapter.ts)**: Defines the `PlatformAdapter` interface for handling platform-specific behaviors, such as link clicks and settings.
- **[setContent.ts](./src/setContent.ts)**: Contains utility functions for processing and sanitizing content before rendering.
- **[connectionStatus.ts](./src/connectionStatus.ts)**: Implements the `ConnectionStatus` model and related utilities for managing and displaying connection states.
- **[contextMenu.ts](./src/contextMenu.ts)**: Implements a lightweight context menu for copy/paste and other text-related actions.
- **[styles/chat.css](./styles/chat.css)**: Provides shared CSS styles for the chat UI, ensuring a consistent look and feel across different hosts.

## How to extend

To customize or extend the `chat-ui` package, follow these steps:

1. **Understand the core component**: Start by reviewing the [chatPanel.ts](./src/chatPanel.ts) file, which contains the implementation of the `ChatPanel` component. This is the central piece of the chat UI.
2. **Add new features**: To introduce new functionality, modify or extend the `ChatPanel` or other relevant components. For example, you can add new methods to handle additional types of messages or interactions.
3. **Update styles**: To change the appearance of the chat UI, edit the [styles/chat.css](./styles/chat.css) file. This file contains the shared CSS styles used across all hosts.
4. **Handle platform-specific needs**: If your host requires custom behavior (e.g., handling specific link clicks or settings), update the [platformAdapter.ts](./src/platformAdapter.ts) file to implement the necessary changes.
5. **Leverage existing utilities**: Use the provided utilities, such as `setContent` and `renderConnectionStatus`, to ensure consistency and reduce duplication.
6. **Test your changes**: After making modifications, test your changes thoroughly. Add or update tests to verify the new functionality.

By following these guidelines, you can effectively extend the `chat-ui` package to meet the requirements of your specific TypeAgent host. For further details, consult the hand-written README and the source files mentioned above.

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
