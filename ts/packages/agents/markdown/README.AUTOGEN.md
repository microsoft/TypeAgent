<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a8cae0a90f91e864a24f2278847850510ca200ef711d4f446303f2ce9047b5c1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# markdown-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `markdown-agent` is a TypeAgent application agent designed to facilitate the creation, editing, and management of markdown documents. It supports a variety of use cases, including real-time collaboration, AI-assisted updates, and advanced markdown processing. By leveraging libraries such as `@milkdown/core` and `@typeagent/aiclient`, the agent provides a structured and extensible framework for handling markdown content in a collaborative and dynamic environment.

## What it does

The `markdown-agent` provides a set of actions to manage markdown documents effectively. These actions include:

- **`createDocument`**: Creates a new markdown document with a specified name.
- **`openDocument`**: Opens an existing markdown document for editing.
- **`updateDocument`**: Allows modifications to a document, such as adding, removing, or editing content.
- **`streamingUpdateDocument`**: Enables real-time updates to a document using AI streaming, allowing for dynamic and interactive editing.

The agent integrates with AI models to enhance document updates, including formatting and content generation. It also supports collaborative editing through Yjs, ensuring consistency across multiple users working on the same document.

## Setup

To set up the `markdown-agent`, you need to configure the following environment variables:

- **`MARKDOWN_FILE`**: The path to the markdown file to be edited. This can be an absolute or relative path.
- **`TYPEAGENT_MARKDOWN_ROOT`**: The root directory for markdown files. This serves as the base directory for file operations.

These environment variables can be set in your shell or defined in the `ts/.env` file. For additional details on obtaining and configuring these values, refer to the hand-written README.

## Key Files

The `markdown-agent` is organized into several key files, each responsible for specific functionality:

### Core Components

- **[markdownManifest.json](./src/agent/markdownManifest.json)**: This file contains metadata about the agent, including its description, emoji identifier, and the schema file it uses. It also specifies the actions supported by the agent, such as `streamingUpdateDocument`.
- **[markdownActionHandler.ts](./src/agent/markdownActionHandler.ts)**: Implements the core logic for handling actions. This includes functions like `executeMarkdownAction` and `streamPartialAction`, which process and execute the defined actions.
- **[markdownActionSchema.ts](./src/agent/markdownActionSchema.ts)**: Defines the structure and parameters for the actions supported by the agent, such as `createDocument`, `openDocument`, `updateDocument`, and `streamingUpdateDocument`.
- **[markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)**: Specifies the types of document operations, such as `insert`, `delete`, `replace`, and `format`. These operations are used to modify markdown documents.

### AI Integration

- **[translator.ts](./src/agent/translator.ts)**: Integrates AI models to translate user actions into document operations. It uses the `TypeChat` library and supports models like `GPT_35_TURBO` and `GPT_4`.

### Collaboration

- **[collaborationManager.ts](./src/view/route/collaborationManager.ts)**: Manages server-side collaboration for document synchronization using Yjs. This ensures that multiple users can edit the same document simultaneously without conflicts.

### Supporting Files

- **[ipcTypes.ts](./src/agent/ipcTypes.ts)**: Defines inter-process communication (IPC) message types for communication between the agent and its view layer.
- **[tsconfig.json](./src/agent/tsconfig.json)**: Configures TypeScript compilation settings for the agent.

## How to extend

To extend the `markdown-agent`, follow these steps:

1. **Add new actions**:

   - Define new action types in [markdownActionSchema.ts](./src/agent/markdownActionSchema.ts). Ensure the new actions are well-structured and include all necessary parameters.

2. **Implement action handlers**:

   - Add the logic for the new actions in [markdownActionHandler.ts](./src/agent/markdownActionHandler.ts). Update the `executeMarkdownAction` function to handle the new actions.

3. **Update schemas**:

   - Modify the schema files ([markdownActionSchema.ts](./src/agent/markdownActionSchema.ts) and [markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)) to include new document operations or action types.

4. **Integrate AI models**:

   - If the new functionality requires AI support, update [translator.ts](./src/agent/translator.ts) to include the necessary logic for translating actions into document operations.

5. **Test your changes**:

   - Write unit tests to validate the new actions and their handlers. Ensure the agent behaves as expected with the new functionality.

6. **Update the manifest**:
   - If the new actions require changes to the agent's metadata, update [markdownManifest.json](./src/agent/markdownManifest.json) to reflect the additions.

By following these steps, you can extend the `markdown-agent` to support additional markdown editing scenarios, integrate new features, or enhance existing functionality.

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

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter markdown-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
