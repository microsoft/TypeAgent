<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=0f5a5f8a999718b2894cf4359d93f82bd73a5ce9838bbabfa5a4c2ce69e56760 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-ui — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `chat-ui` package provides a shared, framework-free chat user interface for various TypeAgent surfaces, including the VS Code shell extension and the browser extension chat panel. It is designed to render user and agent messages, support streaming updates, display dynamic statuses, replay chat history, and provide features like command completions and feedback collection. The package is built with a focus on modularity and reusability, making it adaptable to different host environments.

## What it does

The `chat-ui` package offers the following key features:

- **ChatPanel**: The primary component for rendering the chat interface. It supports:
  - Displaying user and agent messages.
  - Streaming updates for dynamic content.
  - History replay for previously saved conversations.
  - Integration with command completions via the `@typeagent/completion-ui` package.
  - Dynamic status updates and metrics tooltips.
- **FeedbackWidget**: A component for collecting user feedback on interactions within the chat panel.
- **PartialCompletion**: Manages command completions, allowing users to interact with suggestions and auto-complete commands.
- **PlatformAdapter**: Provides an abstraction layer for handling platform-specific behaviors, such as link clicks and settings.
- **ConnectionStatus**: A shared model for representing the agent-server connection state, including reconnect options and error handling.
- **Styles**: A set of shared CSS styles to ensure a consistent look and feel across different host environments.

The package is used by multiple TypeAgent components, including the VS Code shell extension, the browser extension, and the Visual Studio extension webview.

## Setup

To integrate the `chat-ui` package into your project, follow these steps:

1. **Install the package**: Add `chat-ui` to your project using your package manager. For example:

   ```bash
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

3. **Include styles**: The package ships with a CSS file located at [styles/chat.css](./styles/chat.css). You must include this file in your project's build process to ensure the chat UI is styled correctly.

4. **Follow the hand-written README**: For additional setup details, such as environment variables or API keys, refer to the hand-written README.

## Key Files

The `chat-ui` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point, exporting the package's primary components and utilities.
- **[chatPanel.ts](./src/chatPanel.ts)**: Implements the `ChatPanel` component, which is the core of the chat UI. It handles user input, agent messages, and dynamic updates.
- **[feedbackWidget.ts](./src/feedbackWidget.ts)**: Implements the `FeedbackWidget` component for collecting user feedback on chat interactions.
- **[partialCompletion.ts](./src/partialCompletion.ts)**: Manages command completions using the `@typeagent/completion-ui` package.
- **[platformAdapter.ts](./src/platformAdapter.ts)**: Defines the `PlatformAdapter` interface for handling platform-specific behaviors, such as link clicks and settings.
- **[connectionStatus.ts](./src/connectionStatus.ts)**: Contains the `ConnectionStatus` model and related utilities for managing and displaying the agent-server connection state.
- **[contextMenu.ts](./src/contextMenu.ts)**: Implements a lightweight right-click context menu for copy/paste and other text-related actions.
- **[conversationBar.ts](./src/conversationBar.ts)**: Manages the conversation bar, including switching between conversations and displaying connection statuses.
- **[styles/chat.css](./styles/chat.css)**: Provides shared CSS styles for the chat UI.

## How to extend

To extend the `chat-ui` package, follow these steps:

1. **Understand the core components**:

   - Start with [chatPanel.ts](./src/chatPanel.ts) to understand how the `ChatPanel` component is implemented. This is the central component of the chat UI.
   - Review [feedbackWidget.ts](./src/feedbackWidget.ts) and [partialCompletion.ts](./src/partialCompletion.ts) for additional features like feedback collection and command completions.

2. **Add new features**:

   - Implement new functionalities or modify existing ones within the relevant components. For example, you can add new methods to `ChatPanel` for additional interaction types or extend `FeedbackWidget` to support new feedback mechanisms.

3. **Update styles**:

   - Modify [styles/chat.css](./styles/chat.css) to customize the appearance of the chat UI. Ensure that your changes maintain visual consistency across different host environments.

4. **Handle platform-specific behaviors**:

   - If your extension needs to handle specific platform behaviors, update the [platformAdapter.ts](./src/platformAdapter.ts) file. This file abstracts platform-specific logic, making it easier to adapt the chat UI to different environments.

5. **Sanitize new content**:

   - If you add new features that involve rendering HTML content, ensure that the content is sanitized using DOMPurify to prevent security vulnerabilities.

6. **Test your changes**:
   - Add or update tests to cover your new functionalities. Ensure that your changes do not introduce regressions or break existing features.

By following these guidelines, you can effectively extend the `chat-ui` package to meet your specific needs while maintaining compatibility with the rest of the TypeAgent ecosystem.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
