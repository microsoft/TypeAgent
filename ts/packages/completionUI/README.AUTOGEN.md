<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=083cd3713bd4feeb81e023a8519f6576c5f98125700207dda66878ac9e2e0657 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/completion-ui — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/completion-ui` package provides shared DOM UI components for TypeAgent command-completion, including a dropdown menu and a toggle. These components are used across various TypeAgent packages to facilitate user interactions with command completion features.

## What it does

The package offers two main components:

1. **Dropdown Menu**: This component displays a list of command completions in a dropdown format. It is designed to be rendered into the document body and supports keyboard navigation and selection.
2. **Toggle**: This component allows users to expand or collapse the completion menu. It provides a visual indicator and interaction point for toggling the menu's visibility.

The package exports several types and classes to support these components:

- `SearchMenuItem`, `SearchMenuPosition`, `SearchMenuUIUpdateData`, and `SearchMenuUI` from [searchMenuUI.ts](./src/searchMenuUI.ts)
- `LocalSearchMenuUI` from [localSearchMenuUI.ts](./src/localSearchMenuUI.ts)
- `CompletionToggle` and `CompletionToggleDirection` from [completionToggle.ts](./src/completionToggle.ts)

These components are integrated into various TypeAgent packages such as `agent-dispatcher`, `agent-shell`, `chat-ui`, and `vscode-shell`, providing a consistent user experience for command completion across different environments.

## Setup

No additional setup is required beyond installing the package. Simply run `pnpm install` to add `@typeagent/completion-ui` to your project. For detailed setup instructions, see the hand-written README.

## Key Files

The package is structured into several TypeScript files, each responsible for different aspects of the UI components:

- **[index.ts](./src/index.ts)**: The entry point that re-exports the main types and classes.
- **[completionToggle.ts](./src/completionToggle.ts)**: Defines the `CompletionToggle` class, which manages the toggle button for expanding and collapsing the completion menu.
- **[localSearchMenuUI.ts](./src/localSearchMenuUI.ts)**: Implements the `LocalSearchMenuUI` class, which handles the rendering and interaction logic for the dropdown menu.
- **[searchMenuUI.ts](./src/searchMenuUI.ts)**: Contains type definitions and the `SearchMenuUI` interface, which standardizes the methods required for updating and interacting with the search menu UI.
- **[styles.css](./src/styles.css)**: Provides the CSS styles for the dropdown menu, ensuring consistent appearance and behavior across different implementations.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: This file serves as the main entry point for the package, re-exporting all the necessary types and classes from other files. It ensures that users can import everything they need from a single location.
- **[completionToggle.ts](./src/completionToggle.ts)**: This file defines the `CompletionToggle` class, which is responsible for creating and managing the toggle button. The button allows users to expand or collapse the completion menu. It includes methods for setting the direction of the toggle, showing and hiding the button, and handling user interactions.
- **[localSearchMenuUI.ts](./src/localSearchMenuUI.ts)**: This file implements the `LocalSearchMenuUI` class, which manages the dropdown menu's rendering and interaction logic. It includes methods for updating the menu's position, prefix, and items, as well as handling keyboard navigation and selection.
- **[searchMenuUI.ts](./src/searchMenuUI.ts)**: This file contains type definitions and the `SearchMenuUI` interface. The interface standardizes the methods required for updating and interacting with the search menu UI, ensuring consistency across different implementations.
- **[styles.css](./src/styles.css)**: This file provides the CSS styles for the dropdown menu, ensuring a consistent appearance and behavior across different implementations. It includes styles for the container, list items, scrollbar, and various states such as hover and selected.

## How to extend

To extend the functionality of the `@typeagent/completion-ui` package, follow these steps:

1. **Start with the entry point**: Open [index.ts](./src/index.ts) to understand the exported types and classes.
2. **Modify or add components**: If you need to change the behavior of the toggle or dropdown menu, start with [completionToggle.ts](./src/completionToggle.ts) or [localSearchMenuUI.ts](./src/localSearchMenuUI.ts), respectively.
3. **Update styles**: If your changes require new or modified styles, edit [styles.css](./src/styles.css) to ensure the UI remains consistent.
4. **Implement new features**: For new UI components or extensions, create additional TypeScript files and follow the existing patterns for class and type definitions.
5. **Test your changes**: Ensure that your modifications work correctly by running tests and integrating the updated components into the relevant TypeAgent packages.

By following these steps, you can effectively extend and customize the command-completion UI components to meet your project's needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./styles.css` → [./dist/styles.css](./dist/styles.css)

### Dependencies

Workspace: _None._

External: _None at runtime._

### Used by

- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-shell](../../packages/shell/README.md)
- [chat-ui](../../packages/chat-ui/README.md)
- [vscode-shell](../../packages/vscode-shell/README.md)

### Files of interest

`./src/index.ts`, `./src/completionToggle.ts`, `./src/localSearchMenuUI.ts`, …and 3 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/completion-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
