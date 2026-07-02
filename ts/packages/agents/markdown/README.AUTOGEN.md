<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=12077bf10c00c582f1e68ebc5b61857f38566c0193c25a9d62851a2164024c5f -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# markdown-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Markdown Agent is a TypeAgent application agent designed to create and update markdown files. It explores various editing scenarios for markdown documents, leveraging AI streaming support for real-time operations. This agent integrates with several external libraries and services to provide a comprehensive markdown editing experience.

## What it does

The Markdown Agent supports several actions related to markdown document management:

- `createDocument`: Creates a new markdown document.
- `openDocument`: Opens an existing markdown document.
- `updateDocument`: Updates the document by adding, removing, or editing parts of the document.
- `streamingUpdateDocument`: Updates the document with streaming support for real-time AI operations.

These actions enable users to manage markdown documents efficiently, with capabilities for real-time collaboration and AI-assisted editing. The agent leverages libraries such as `@milkdown/core` for markdown processing and `Yjs` for collaborative editing.

## Setup

To set up the Markdown Agent, you need to configure the following environment variables:

- `MARKDOWN_FILE`: Specifies the path to the markdown file to be edited.
- `TYPEAGENT_MARKDOWN_ROOT`: Defines the root directory for markdown files.

Ensure these environment variables are set in your shell or in the `ts/.env` file. For detailed setup instructions, see the hand-written README.

## Key Files

The Markdown Agent's architecture is organized into several key components:

- **Manifest**: The [markdownManifest.json](./src/agent/markdownManifest.json) file defines the agent's schema, description, and supported actions.
- **Handlers**: The [markdownActionHandler.ts](./src/agent/markdownActionHandler.ts) file contains the logic for executing actions and managing the agent's context.
- **Schemas**: The [markdownActionSchema.ts](./src/agent/markdownActionSchema.ts) and [markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts) files define the types and structures for actions and document operations.
- **Translator**: The [translator.ts](./src/agent/translator.ts) file handles the integration with AI models and translates actions into operations.
- **Collaboration Manager**: The [collaborationManager.ts](./src/view/route/collaborationManager.ts) file manages server-side collaboration for document synchronization using Yjs.

### Key Files and Their Responsibilities

- **[markdownManifest.json](./src/agent/markdownManifest.json)**: Contains metadata about the agent, including its description, schema, and supported actions.
- **[markdownActionHandler.ts](./src/agent/markdownActionHandler.ts)**: Implements the core logic for handling actions such as `createDocument`, `openDocument`, `updateDocument`, and `streamingUpdateDocument`.
- **[markdownActionSchema.ts](./src/agent/markdownActionSchema.ts)**: Defines the structure and types for the actions supported by the agent.
- **[markdownOperationSchema.ts](./src/agent/markdownOperationSchema.ts)**: Specifies the types of document operations, such as insert, delete, replace, and format.
- **[translator.ts](./src/agent/translator.ts)**: Integrates AI models to translate actions into document operations.
- **[collaborationManager.ts](./src/view/route/collaborationManager.ts)**: Manages collaborative editing sessions using Yjs.

## How to extend

To extend the Markdown Agent, follow these steps:

1. **Add new actions**: Define new action types in [markdownActionSchema.ts](./src/agent/markdownActionSchema.ts). Ensure they are properly structured and include necessary parameters.
2. **Implement action handlers**: Add logic for handling new actions in [markdownActionHandler.ts](./src/agent/markdownActionHandler.ts). Implement the `executeMarkdownAction` function to process the new actions.
3. **Update schemas**: Modify the schema files to include new document operations or action types. Ensure consistency between the schema definitions and the action handlers.
4. **Test your changes**: Write tests to validate the new actions and their handlers. Ensure that the agent behaves as expected with the new functionality.

By following these steps, you can extend the capabilities of the Markdown Agent to support additional markdown editing scenarios and integrate new features.

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

`./src/agent/markdownManifest.json`, `./src/agent/markdownActionHandler.ts`, `./src/agent/markdownActionSchema.ts`, …and 28 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `MARKDOWN_FILE`
- `TYPEAGENT_MARKDOWN_ROOT`

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter markdown-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
