<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=315de89c9a91866e5c7a732397e2d8805d68b4402fe93a4b8847f990b23b5081 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `chat-agent` package is a TypeAgent application agent designed to handle chat interactions and perform information lookups. It leverages structured prompting and large language models (LLMs) to generate responses and perform lookups using external sources like web search engines.

## What it does

The `chat-agent` package provides functionality for handling chat interactions and generating responses based on structured schemas. It supports actions such as `generateResponse` and `showImageFile`, which allow the agent to respond to user queries and display images. The agent can perform lookups using external sources, such as Bing, to provide additional information when needed.

Key actions include:

- `generateResponse`: Generates a response based on known information or context.
- `showImageFile`: Displays images based on provided file entities.

The agent integrates with other parts of the system, such as the `default-agent-provider`, `greeting-agent`, and `settings-agent`, to provide a cohesive chat experience.

## Setup

To enable the lookup functionality, you need to add your Bing API key to the root `.env` file with the following key:

- `BING_API_KEY`: Obtain a Bing API key from the Bing developer portal and set it in the `.env` file.

If the Bing API key is not available, the agent will return a "No Information available" response.

## Key Files

The `chat-agent` package is structured around a manifest, schema, and handler:

- **Manifest**: The [chatManifest.json](./src/chatManifest.json) file defines the agent's description, schema, and actions.
- **Schema**: The [chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts) file defines the types and structure of actions the agent can perform, such as `GenerateResponseAction` and `ShowImageFileAction`.
- **Handler**: The [chatResponseHandler.ts](./src/chatResponseHandler.ts) file contains the logic for executing actions and handling responses, including rehydrating images and performing lookups.

The main entry point is [index.ts](./src/index.ts), which exports the agent instantiation and action execution functions.

## How to extend

To extend the `chat-agent` package, follow these steps:

1. **Open the handler file**: Start with [chatResponseHandler.ts](./src/chatResponseHandler.ts). This file contains the core logic for handling actions and generating responses.
2. **Add new actions**: Define new actions in the [chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts) file. Ensure the new actions are properly typed and structured.
3. **Implement action handling**: Add the logic for handling new actions in [chatResponseHandler.ts](./src/chatResponseHandler.ts). Follow the existing patterns for executing actions and generating responses.
4. **Update the manifest**: Modify [chatManifest.json](./src/chatManifest.json) to include the new actions and update the schema if necessary.
5. **Test your changes**: Run tests to ensure the new actions are working as expected. Add new test cases if needed.

By following these steps, you can extend the functionality of the `chat-agent` package to handle additional types of interactions and responses.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/chatManifest.json](./src/chatManifest.json)
- `./agent/handlers` → [./dist/chatResponseHandler.js](./dist/chatResponseHandler.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [aiclient](../../../packages/aiclient/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [typeagent](../../../packages/typeagent/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)

External: `@azure/ai-agents`, `@azure/ai-projects`, `@azure/identity`, `typechat`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- [greeting-agent](../../../packages/agents/greeting/README.md)
- [settings-agent](../../../packages/agents/settings/README.md)

### Files of interest

`./src/chatManifest.json`, `./src/chatResponseActionSchema.ts`, `./src/chatResponseHandler.ts`, …and 2 more under `./src/`.

### Agent surface

- Manifest: [./src/chatManifest.json](./src/chatManifest.json)
- Schema: [./src/chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts)
- Handler: [./src/chatResponseHandler.ts](./src/chatResponseHandler.ts)

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.407Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
