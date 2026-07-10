<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a8cae0a90f91e864a24f2278847850510ca200ef711d4f446303f2ce9047b5c1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# markdown-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Markdown Agent is a TypeAgent application agent designed to facilitate the creation, editing, and management of markdown documents. It supports a variety of editing scenarios, including real-time collaboration, AI-assisted updates, and advanced markdown processing. This agent is particularly useful for scenarios involving GitHub-flavored markdown and integrates with libraries like `@milkdown/core` and `@typeagent/aiclient` to enhance its functionality.

## What it does

The Markdown Agent provides a set of actions to manage markdown documents effectively. These actions include:

- **`createDocument`**: Creates a new markdown document with a specified name.
- **`openDocument`**: Opens an existing markdown document for editing.
- **`updateDocument`**: Updates a document by adding, removing, or modifying its content. This action supports operations such as inserting, deleting, replacing, and formatting text.
- **`streamingUpdateDocument`**: Enables real-time updates to a document using AI streaming support, allowing for dynamic and interactive editing.

The agent leverages advanced libraries such as `@milkdown/core` for markdown processing, Yjs for collaborative editing, and AI models for intelligent content updates. These capabilities make it suitable for both individual and collaborative markdown editing workflows.

## Setup

To configure the Markdown Agent, you need to set the following environment variables:

- **`MARKDOWN_FILE`**: Specifies the path to the markdown file to be edited. This can be an absolute or relative path.
- **`TYPEAGENT_MARKDOWN_ROOT`**: Defines the root directory for markdown files. This is used as the base directory for file operations.

These variables can be set in your shell or in the `ts/.env` file. If additional guidance is needed, refer to the hand-written README for more details on obtaining and configuring these values.

## Key Files

The implementation of the Markdown Agent is organized into several key files, each responsible for specific aspects of its functionality:

- **Manifest**:

  - [markdownManifest.json](./src/agent/markdownManifest.json): Contains metadata about the agent, including its description, supported actions, and schema details.

- **Action Handlers**:

  - [markdownActionHandler.ts](./src/agent/markdownActionHandler.ts): Implements the logic for handling actions such as `createDocument`, `openDocument`, `updateDocument`, and `streamingUpdateDocument`. This file is the core of the agent's functionality.

- **Schemas**:

  - [markdownActionSchema.ts](./src/agent/markdownActionSchema.ts): Defines the structure and parameters for the actions supported by the agent.
  - [markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts): Specifies the types of document operations, such as insert, delete, replace, and format.

- **Translator**:

  - [translator.ts](./src/agent/translator.ts): Integrates AI models and translates user actions into document operations. This file is critical for enabling AI-assisted updates.

- **Collaboration Manager**:
  - [collaborationManager.ts](./src/view/route/collaborationManager.ts): Manages server-side collaboration for real-time document synchronization using Yjs.

### File Responsibilities

- **[markdownManifest.json](./src/agent/markdownManifest.json)**: Defines the agent's metadata, including its emoji identifier, description, and the schema file it uses.
- **[markdownActionHandler.ts](./src/agent/markdownActionHandler.ts)**: Contains the main logic for executing and validating actions, as well as handling streaming updates.
- **[markdownActionSchema.ts](./src/agent/markdownActionSchema.ts)**: Specifies the types and parameters for actions like `createDocument` and `updateDocument`.
- **[markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)**: Details the types of operations (e.g., insert, delete) that can be performed on a markdown document.
- **[translator.ts](./src/agent/translator.ts)**: Handles the integration with AI models, translating user actions into document operations.
- **[collaborationManager.ts](./src/view/route/collaborationManager.ts)**: Ensures consistency across clients during collaborative editing sessions.

## How to extend

To extend the Markdown Agent, follow these steps:

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

By following these steps, you can enhance the Markdown Agent to support additional markdown editing scenarios, integrate new features, or improve existing functionality.

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

_Auto-generated against commit `463e6bf5c6f8eeaf9cc7512e33f3976761eece62` on `2026-07-10T09:05:05.791Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter markdown-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
