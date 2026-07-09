<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=49e09d4b91a24c9fd317cd3475692d6e1d1fbd361801db2dcad8677b5918b721 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `chat-agent` package is a TypeAgent application agent designed to handle conversational interactions using structured prompting and large language models (LLMs). It serves as a sample implementation for building typed chat agents that leverage schemas to generate structured responses and perform external information lookups. This package demonstrates how to integrate LLMs with external data sources, such as Bing, to enhance the quality and relevance of responses.

## What it does

The `chat-agent` facilitates conversational interactions by processing user inputs and generating structured responses. It uses a schema-driven approach to ensure that all interactions are well-typed and consistent. The agent supports the following key actions:

- **`generateResponse`**: This action generates a response based on the provided context or known information. It is used for general conversation, answering questions, and providing explanations.
- **`showImageFile`**: This action displays images based on file entities provided in the request. It includes functionality to rehydrate images from storage and render them in the response.

The agent also supports external lookups for additional information. For example, it can query Bing to fetch supplementary data when the required information is not available in the chat history or application memory. If no external data source is configured, the agent gracefully handles such cases by returning a "No Information available" response.

The `chat-agent` is designed to work alongside other agents, such as the `default-agent-provider`, `greeting-agent`, and `settings-agent`, to provide a cohesive and interactive user experience.

## Setup

To enable the external lookup functionality, you need to configure a Bing API key. This key allows the agent to perform lookups using Bing. Follow these steps to set up the key:

1. Obtain a Bing API key from the Bing developer portal.
2. Add the key to the root configuration file:
   - If using `config.local.yaml`, add the key under the `bing.apiKey` field.
   - Alternatively, you can add the key to a `.env` file using the key `BING_API_KEY`.

If the Bing API key is not provided, the agent will return a "No Information available" response when a lookup is required.

## Key Files

The `chat-agent` package is organized into several key files that define its structure and functionality:

- **[chatManifest.json](./src/chatManifest.json)**: This file serves as the agent's manifest, describing its purpose, schema, and available actions. It specifies the schema file and the types of actions the agent can perform, such as `generateResponse` and `showImageFile`.

- **[chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts)**: This file defines the structured schema for the agent's actions. It includes type definitions for actions like `GenerateResponseAction` and `ShowImageFileAction`, ensuring that all interactions are well-typed and adhere to the expected structure.

- **[chatResponseHandler.ts](./src/chatResponseHandler.ts)**: This file contains the core logic for handling actions and generating responses. It includes:

  - Functions for executing actions and streaming partial responses.
  - Logic for performing external lookups using Bing.
  - Code for rehydrating images for the `showImageFile` action.

- **[index.ts](./src/index.ts)**: The main entry point for the package. It exports the agent instantiation function and key action execution functions, making them accessible to other parts of the system.

## How to extend

To customize or extend the `chat-agent` package, you can add new actions, modify existing ones, or integrate additional data sources. Here’s how to get started:

1. **Understand the existing structure**: Begin by reviewing the key files, especially [chatResponseHandler.ts](./src/chatResponseHandler.ts) and [chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts), to understand the current implementation.

2. **Add new actions**:

   - Define new action types in [chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts). Ensure the new actions are well-typed and follow the existing schema structure.
   - Update [chatManifest.json](./src/chatManifest.json) to include the new actions and update the schema if necessary.

3. **Implement action handling**:

   - Add the logic for handling the new actions in [chatResponseHandler.ts](./src/chatResponseHandler.ts). Use the existing patterns for executing actions and generating responses as a guide.
   - If the new action requires external data, integrate the necessary data source (e.g., an API) into the handler.

4. **Test your changes**:

   - Write unit tests to verify the functionality of the new actions. Ensure that edge cases and error handling are adequately covered.
   - Test the integration with external data sources, if applicable.

5. **Update documentation**:
   - Document the new actions and any changes to the schema or handler in the relevant files.
   - Ensure the `chatManifest.json` file reflects the updated capabilities of the agent.

By following these steps, you can extend the `chat-agent` package to meet specific requirements or integrate additional features, such as new response types or data sources.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/chatManifest.json](./src/chatManifest.json)
- `./agent/handlers` → `./dist/chatResponseHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [typeagent](../../../packages/typeagent/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)

External: `typechat`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- [greeting-agent](../../../packages/agents/greeting/README.md)
- [settings-agent](../../../packages/agents/settings/README.md)

### Files of interest

`./src/chatManifest.json`, `./src/chatResponseActionSchema.ts`, `./src/chatResponseHandler.ts`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/chatManifest.json](./src/chatManifest.json)
- Schema: [./src/chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts)
- Handler: [./src/chatResponseHandler.ts](./src/chatResponseHandler.ts)

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
