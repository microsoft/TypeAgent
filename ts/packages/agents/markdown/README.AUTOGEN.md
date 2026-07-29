<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=735cce73f8151e25677525870454d1d8c0c989835cb3f5078e348663c1256748 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# markdown-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `markdown-agent` is a TypeAgent application agent designed to handle markdown document creation, editing, and management. It supports a variety of use cases, including real-time collaboration, AI-assisted updates, and advanced markdown processing. This package is part of the TypeAgent monorepo and serves as a sample implementation for exploring markdown editing scenarios, particularly with GitHub-flavored markdown.

## What it does

The `markdown-agent` provides a set of actions to manage markdown documents effectively. These actions include:

- **`createDocument`**: Creates a new markdown document with a specified name.
- **`openDocument`**: Opens an existing markdown document for editing.
- **`updateDocument`**: Updates a document by performing operations such as inserting, deleting, replacing, or formatting text.
- **`streamingUpdateDocument`**: Enables real-time updates to a document using AI streaming support, allowing for dynamic and interactive editing.

### Key Features

1. **Markdown Processing**: The agent uses the `@milkdown` library and its plugins for rendering and editing markdown content. It supports both CommonMark and GitHub-flavored markdown.
2. **Real-Time Collaboration**: The agent integrates with Yjs to enable multiple users to collaborate on the same document in real time.
3. **AI-Assisted Updates**: By leveraging `@typeagent/aiclient`, the agent provides intelligent suggestions and real-time content updates powered by AI models.
4. **Advanced Document Operations**: The agent supports a variety of document operations, including inserting, deleting, replacing, and formatting content. These operations are defined in the [markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts) file.

## Setup

To configure the `markdown-agent`, you need to set the following environment variables:

- **`MARKDOWN_FILE`**: Specifies the path to the markdown file to be edited. This can be an absolute or relative path.
- **`TYPEAGENT_MARKDOWN_ROOT`**: Defines the root directory for markdown files. This is used as the base directory for file operations.

These variables can be set in your shell or in the `ts/.env` file. For more details on obtaining and configuring these values, refer to the hand-written README.

## Key Files

The `markdown-agent` is implemented across several key files, each responsible for specific aspects of its functionality:

### Manifest

- **[markdownManifest.json](./src/agent/markdownManifest.json)**: Contains metadata about the agent, including its description, supported actions, and schema details. It also specifies the emoji identifier for the agent and the schema file used for action validation.

### Action Handlers

- **[markdownActionHandler.ts](./src/agent/markdownActionHandler.ts)**: Implements the core logic for handling actions such as `createDocument`, `openDocument`, `updateDocument`, and `streamingUpdateDocument`. This file serves as the main entry point for executing and validating actions.

### Schemas

- **[markdownActionSchema.ts](./src/agent/markdownActionSchema.ts)**: Defines the structure and parameters for the actions supported by the agent. This includes the types of actions and their required inputs.
- **[markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)**: Specifies the types of document operations, such as insert, delete, replace, and format. These operations are used to modify markdown documents.

### Translator

- **[translator.ts](./src/agent/translator.ts)**: Integrates AI models and translates user actions into document operations. It is a critical component for enabling AI-assisted updates and real-time collaboration.

### Collaboration Manager

- **[collaborationManager.ts](./src/view/route/collaborationManager.ts)**: Manages server-side collaboration for real-time document synchronization using Yjs. This file ensures consistency across clients during collaborative editing sessions.

## How to extend

To extend the functionality of the `markdown-agent`, follow these steps:

1. **Define new actions**:

   - Add new action types in [markdownActionSchema.ts](./src/agent/markdownActionSchema.ts). Ensure the new actions are well-structured and include all necessary parameters.

2. **Implement action handlers**:

   - Add the logic for the new actions in [markdownActionHandler.ts](./src/agent/markdownActionHandler.ts). Update the `executeMarkdownAction` function to handle the new actions.

3. **Update schemas**:

   - Modify the schema files ([markdownActionSchema.ts](./src/agent/markdownActionSchema.ts) and [markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)) to include new document operations or action types.

4. **Test your changes**:

   - Write unit tests to validate the new actions and their handlers. Ensure the agent behaves as expected with the new functionality.

5. **Update the manifest**:

   - If the new actions require changes to the agent's metadata, update [markdownManifest.json](./src/agent/markdownManifest.json) to reflect the additions.

6. **Add collaboration support (if needed)**:
   - If the new functionality involves real-time collaboration, update [collaborationManager.ts](./src/view/route/collaborationManager.ts) to handle the new operations.

By following these steps, you can enhance the `markdown-agent` to support additional markdown editing scenarios, integrate new features, or improve existing functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/agent/markdownManifest.json](./src/agent/markdownManifest.json)
- `./agent/handlers` → [./dist/agent/markdownActionHandler.js](./dist/agent/markdownActionHandler.js)

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

`./src/agent/markdownManifest.json`, `./src/agent/markdownActionHandler.ts`, `./src/agent/markdownActionSchema.ts`, …and 29 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `MARKDOWN_FILE`
- `TYPEAGENT_MARKDOWN_ROOT`

---

_Auto-generated against commit `6bea19a9ee02598644b1ac3ab67c705dcc495832` on `2026-07-22T11:19:17.632Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter markdown-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
