<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9c136e066cb4fe832f2bc1ecd3ce36c48323de3f20631f8b793beece9e86435c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-ui â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The `chat-ui` package provides shared DOM-based chat rendering for TypeAgent surfaces, including the VS Code shell extension and the browser extension chat panel. It offers a framework-free chat UI that supports rendering user and agent bubbles, streaming display updates, dynamic status, history replay, command completions, and metrics tooltips.

## What it does

The `chat-ui` package includes several key components and functionalities:

- **ChatPanel**: The main component for rendering the chat interface. It handles user input, agent messages, and display updates.
- **FeedbackWidget**: A component for collecting user feedback on interactions within the chat panel.
- **PartialCompletion**: Manages command completions using the `@typeagent/completion-ui` package.
- **PlatformAdapter**: Abstracts platform-specific behaviors for handling link clicks and settings.
- **Styles**: Shared CSS styles for consistent chat UI appearance across different hosts.

The package supports actions such as `addAgentMessage`, `setDisplayInfo`, and `replayHistory`, which allow hosts to interact with the chat panel and update its content dynamically.

## Setup

To use the `chat-ui` package, you need to install it and its dependencies. Ensure you have the following workspace dependencies:

- `@typeagent/agent-sdk`
- `@typeagent/completion-ui`
- `@typeagent/dispatcher-types`

Additionally, the package relies on external dependencies such as `ansi_up`, `dompurify`, and `markdown-it`.

For detailed setup instructions, including environment variables and API keys, refer to the hand-written README.

## Key Files
The `chat-ui` package is organized into several key files:

- **[index.ts](./src/index.ts)**: Exports the main components and types used by the package.
- **[chatPanel.ts](./src/chatPanel.ts)**: Implements the `ChatPanel` component, handling user input, agent messages, and display updates.
- **[feedbackWidget.ts](./src/feedbackWidget.ts)**: Implements the `FeedbackWidget` component for collecting user feedback.
- **[partialCompletion.ts](./src/partialCompletion.ts)**: Manages command completions using the `@typeagent/completion-ui` package.
- **[platformAdapter.ts](./src/platformAdapter.ts)**: Defines the `PlatformAdapter` interface for handling platform-specific behaviors.
- **[setContent.ts](./src/setContent.ts)**: Contains functions for processing and sanitizing content before rendering.
- **[styles/chat.css](./styles/chat.css)**: Provides shared CSS styles for the chat UI.

### Key Components

- **ChatPanel**: The core component of the chat UI, responsible for rendering user and agent messages, handling user input, and updating the display dynamically. It uses DOMPurify to sanitize HTML content before insertion.
- **FeedbackWidget**: Collects user feedback on interactions within the chat panel. It includes methods for submitting feedback and managing the feedback UI.
- **PartialCompletion**: Integrates with the `@typeagent/completion-ui` package to manage command completions. It handles input updates, completion acceptance, and dismissal.
- **PlatformAdapter**: Abstracts platform-specific behaviors, such as handling link clicks and settings. This allows the chat UI to be adaptable to different environments like Electron and Chrome extensions.
- **Styles**: Shared CSS styles that ensure a consistent appearance of the chat UI across different hosts.

## How to extend

To extend the `chat-ui` package, follow these steps:

1. **Start with the main component**: Open the [chatPanel.ts](./src/chatPanel.ts) file to understand how the `ChatPanel` component is implemented. This is the core of the chat UI.
2. **Add new features**: Implement new functionalities or modify existing ones within the `ChatPanel` component. Ensure that any new HTML content is sanitized using DOMPurify.
3. **Update styles**: If you need to change the appearance of the chat UI, modify the [styles/chat.css](./styles/chat.css) file.
4. **Handle platform-specific behaviors**: If your extension needs to handle specific platform behaviors, update the [platformAdapter.ts](./src/platformAdapter.ts) file.
5. **Test your changes**: Run tests to ensure your changes work as expected. You can add new tests or modify existing ones to cover your new functionalities.

By following these steps, you can effectively extend the `chat-ui` package to meet your specific requirements. For detailed instructions and examples, refer to the hand-written README.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default â†’ [./dist/index.js](./dist/index.js)
- `./styles` â†’ [./styles/chat.css](./styles/chat.css)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/completion-ui](../../packages/completionUI/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)

External: `ansi_up`, `dompurify`, `markdown-it`

### Used by

- [browser-typeagent](../../packages/agents/browser/README.md)
- visualstudio-extension-webview
- [vscode-shell](../../packages/vscode-shell/README.md)

### Files of interest

`./src/index.ts`, `./src/chatPanel.ts`, `./src/feedbackWidget.ts`, â€¦and 4 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.903Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
