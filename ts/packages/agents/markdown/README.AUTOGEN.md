<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=67e5f8d8e2239c53527524511927e4acaa8b1f986abcdd6b9c9511b4a3e5e037 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# markdown-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Markdown Agent is a TypeAgent application agent designed for creating and editing markdown documents. It supports various editing scenarios, including real-time collaboration and AI-assisted updates, making it a versatile tool for managing markdown content.

## What it does

The Markdown Agent provides functionality for managing markdown documents through the following actions:

- `createDocument`: Creates a new markdown document.
- `openDocument`: Opens an existing markdown document for editing.
- `updateDocument`: Modifies a document by adding, removing, or editing its content.
- `streamingUpdateDocument`: Updates a document with real-time AI streaming support, enabling dynamic and interactive editing.

These actions allow users to efficiently manage markdown files, with support for collaborative editing using Yjs and advanced markdown processing through libraries like `@milkdown/core`. The agent also integrates with AI models to enhance document updates and formatting.

## Setup

To configure the Markdown Agent, you need to set the following environment variables:

- `MARKDOWN_FILE`: Specifies the path to the markdown file to be edited. This can be an absolute or relative path.
- `TYPEAGENT_MARKDOWN_ROOT`: Defines the root directory for markdown files. This is used as the base directory for file operations.

These variables can be set in your shell or in the `ts/.env` file. Refer to the hand-written README for additional details on obtaining and configuring these values.

## Key Files

The Markdown Agent's implementation is organized into several key files, each responsible for specific aspects of the agent's functionality:

- **Manifest**: The [markdownManifest.json](./src/agent/markdownManifest.json) file defines the agent's metadata, including its description, schema, and supported actions.
- **Action Handlers**: The [markdownActionHandler.ts](./src/agent/markdownActionHandler.ts) file contains the core logic for executing actions such as `createDocument`, `openDocument`, `updateDocument`, and `streamingUpdateDocument`.
- **Schemas**:
  - [markdownActionSchema.ts](./src/agent/markdownActionSchema.ts): Defines the structure and types for the actions supported by the agent.
  - [markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts): Specifies the types of document operations, such as insert, delete, replace, and format.
- **Translator**: The [translator.ts](./src/agent/translator.ts) file integrates AI models and translates actions into document operations.
- **Collaboration Manager**: The [collaborationManager.ts](./src/view/route/collaborationManager.ts) file manages server-side collaboration for document synchronization using Yjs.

### File Responsibilities

- **[markdownManifest.json](./src/agent/markdownManifest.json)**: Contains metadata about the agent, including its emoji identifier, description, and the schema file it uses.
- **[markdownActionHandler.ts](./src/agent/markdownActionHandler.ts)**: Implements the logic for handling actions, including validation, execution, and streaming updates.
- **[markdownActionSchema.ts](./src/agent/markdownActionSchema.ts)**: Defines the types and parameters for actions like `createDocument` and `updateDocument`.
- **[markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)**: Details the types of operations (e.g., insert, delete) that can be performed on a markdown document.
- **[translator.ts](./src/agent/translator.ts)**: Handles the integration with AI models, translating user actions into document operations.
- **[collaborationManager.ts](./src/view/route/collaborationManager.ts)**: Manages collaborative editing sessions, ensuring consistency across clients using Yjs.

## How to extend

To extend the Markdown Agent, follow these steps:

1. **Define new actions**: Add new action types in [markdownActionSchema.ts](./src/agent/markdownActionSchema.ts). Ensure the new actions are well-structured and include all necessary parameters.
2. **Implement action handlers**: Add logic for the new actions in [markdownActionHandler.ts](./src/agent/markdownActionHandler.ts). Update the `executeMarkdownAction` function to handle the new actions appropriately.
3. **Update schemas**: Modify the schema files ([markdownActionSchema.ts](./src/agent/markdownActionSchema.ts) and [markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)) to include new document operations or action types.
4. **Test your changes**: Write unit tests to validate the new actions and their handlers. Ensure the agent behaves as expected with the new functionality.
5. **Update the manifest**: If the new actions require changes to the agent's metadata, update [markdownManifest.json](./src/agent/markdownManifest.json) to reflect the additions.

By following these steps, you can extend the Markdown Agent to support additional markdown editing scenarios, integrate new features, or enhance existing functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/agent/markdownManifest.json](./src/agent/markdownManifest.json)
- `./agent/handlers` → `./dist/agent/markdownActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/websocket-utils](../../../packages/utils/webSocketUtils/README.md)
- [telemetry](../../../packages/telemetry/README.md)

External: `@milkdown/core`, `@milkdown/crepe`, `@milkdown/plugin-collab`, `@milkdown/plugin-history`, `@milkdown/preset-commonmark`, `@milkdown/preset-gfm`, `@milkdown/theme-nord`, `@milkdown/utils`, `debug`, `dompurify`, `express`, `express-rate-limit`, `katex`, `lib0`, `markdown-it`, `markdown-it-texmath`, `mermaid`, `prosemirror-inputrules`, `prosemirror-model`, `prosemirror-state`

_…and 8 more not shown._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/agent/markdownManifest.json`, `./src/agent/markdownActionHandler.ts`, `./src/agent/markdownActionSchema.ts`, …and 28 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `MARKDOWN_FILE`
- `TYPEAGENT_MARKDOWN_ROOT`

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter markdown-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
