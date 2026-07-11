<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a8cae0a90f91e864a24f2278847850510ca200ef711d4f446303f2ce9047b5c1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# markdown-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `markdown-agent` is a TypeAgent application agent designed to handle the creation, editing, and management of markdown documents. It supports a variety of use cases, including real-time collaboration, AI-assisted content updates, and advanced markdown processing. The agent is particularly suited for working with GitHub-flavored markdown and integrates with several libraries, such as `@milkdown/core` and `@typeagent/aiclient`, to provide a feature-rich editing experience.

## What it does

The `markdown-agent` provides a set of actions to facilitate markdown document management. These actions include:

- **`createDocument`**: Creates a new markdown document with a specified name.
- **`openDocument`**: Opens an existing markdown document for editing.
- **`updateDocument`**: Updates a document by performing operations such as inserting, deleting, replacing, or formatting text.
- **`streamingUpdateDocument`**: Enables real-time updates to a document using AI streaming support, allowing for dynamic and interactive editing.

The agent leverages a combination of advanced libraries and tools to deliver its functionality:

- **Markdown processing**: Utilizes `@milkdown/core` and related plugins for rendering and editing markdown content.
- **Real-time collaboration**: Employs Yjs for collaborative editing, enabling multiple users to work on the same document simultaneously.
- **AI-assisted updates**: Integrates with AI models via `@typeagent/aiclient` to provide intelligent suggestions and real-time content updates.

These features make the `markdown-agent` a versatile tool for both individual and collaborative markdown editing workflows.

## Setup

To configure the `markdown-agent`, you need to set the following environment variables:

- **`MARKDOWN_FILE`**: Specifies the path to the markdown file to be edited. This can be an absolute or relative path.
- **`TYPEAGENT_MARKDOWN_ROOT`**: Defines the root directory for markdown files. This is used as the base directory for file operations.

You can set these variables in your shell or in the `ts/.env` file. For additional details on obtaining and configuring these values, refer to the hand-written README.

## Key Files

The `markdown-agent` is implemented across several key files, each responsible for specific functionalities:

### Manifest

- **[markdownManifest.json](./src/agent/markdownManifest.json)**: This file contains metadata about the agent, including its description, supported actions, and schema details. It also specifies the emoji identifier for the agent and the schema file used for action validation.

### Action Handlers

- **[markdownActionHandler.ts](./src/agent/markdownActionHandler.ts)**: This file implements the core logic for handling actions such as `createDocument`, `openDocument`, `updateDocument`, and `streamingUpdateDocument`. It includes the `executeMarkdownAction` function, which serves as the main entry point for executing actions.

### Schemas

- **[markdownActionSchema.ts](./src/agent/markdownActionSchema.ts)**: Defines the structure and parameters for the actions supported by the agent, such as `createDocument` and `updateDocument`.
- **[markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)**: Specifies the types of document operations, including `insert`, `delete`, `replace`, and `format`.

### Translator

- **[translator.ts](./src/agent/translator.ts)**: Integrates AI models and translates user actions into document operations. This file is essential for enabling AI-assisted updates and real-time content generation.

### Collaboration Manager

- **[collaborationManager.ts](./src/view/route/collaborationManager.ts)**: Manages server-side collaboration for real-time document synchronization using Yjs. It ensures consistency across clients during collaborative editing sessions.

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

`./src/agent/markdownManifest.json`, `./src/agent/markdownActionHandler.ts`, `./src/agent/markdownActionSchema.ts`, …and 29 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `MARKDOWN_FILE`
- `TYPEAGENT_MARKDOWN_ROOT`

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter markdown-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
