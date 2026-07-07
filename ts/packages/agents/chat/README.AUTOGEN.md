<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=1b208f66acb97ba7bb73c99c2a8995d4e59b3ad29132ea0d545597153258fbbc -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `chat-agent` package is a TypeAgent application agent designed to handle chat-based interactions. It uses structured prompting and large language models (LLMs) to generate responses and perform information lookups. This package serves as a sample implementation, demonstrating how to build a typed chat agent that integrates schema-based responses and external data lookups.

## What it does

The `chat-agent` is designed to facilitate conversational interactions by leveraging structured schemas and LLMs. It supports actions that allow the agent to generate responses and perform additional lookups for information when required. The agent can integrate with external data sources, such as Bing, to fetch supplementary information and provide more comprehensive responses.

Key actions include:

- `generateResponse`: Produces a response based on the provided context or known information. This action is used for general conversation and answering questions.
- `showImageFile`: Displays images based on file entities provided in the request. This action supports rehydrating images from storage and rendering them in the response.

The agent is designed to work in conjunction with other agents, such as the `default-agent-provider`, `greeting-agent`, and `settings-agent`, to provide a cohesive and interactive user experience.

## Setup

To enable the lookup functionality, you need to configure the Bing API key. This key is required for the agent to perform external lookups using Bing. Follow these steps:

1. Obtain a Bing API key from the Bing developer portal.
2. Add the key to the root configuration file:
   - If using `config.local.yaml`, add the key under the `bing.apiKey` field.
   - Alternatively, you can add the key to a `.env` file using the key `BING_API_KEY`.

If the Bing API key is not provided, the agent will return a "No Information available" response when a lookup is required.

## Key Files

The `chat-agent` package is organized into several key files that define its functionality:

- **[chatManifest.json](./src/chatManifest.json)**: This file serves as the agent's manifest, defining its description, schema, and available actions. It specifies the schema file and the types of actions the agent can perform, such as `generateResponse` and `showImageFile`.
- **[chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts)**: This file defines the structured schema for the agent's actions. It includes type definitions for actions like `GenerateResponseAction` and `ShowImageFileAction`, ensuring that all interactions are well-typed and consistent.

- **[chatResponseHandler.ts](./src/chatResponseHandler.ts)**: This file contains the core logic for handling actions and generating responses. It includes functions for executing actions, streaming partial responses, and performing lookups using external sources like Bing. It also handles tasks such as rehydrating images for the `showImageFile` action.

- **[index.ts](./src/index.ts)**: This is the main entry point for the package. It exports the agent instantiation function and key action execution functions, making them available for use by other parts of the system.

## How to extend

To extend the functionality of the `chat-agent` package, you can add new actions, modify existing ones, or integrate additional data sources. Follow these steps:

1. **Start with the handler**: Open [chatResponseHandler.ts](./src/chatResponseHandler.ts). This file contains the logic for handling actions and generating responses. Use it as the starting point for implementing new functionality.

2. **Define new actions**: Add new action types to the [chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts) file. Ensure the new actions are well-typed and follow the existing schema structure.

3. **Implement action handling**: Add the logic for handling the new actions in [chatResponseHandler.ts](./src/chatResponseHandler.ts). Use the existing patterns for executing actions and generating responses as a guide.

4. **Update the manifest**: Modify [chatManifest.json](./src/chatManifest.json) to include the new actions and update the schema if necessary. This ensures the agent recognizes and supports the new functionality.

5. **Test your changes**: Write and run tests to verify that the new actions work as expected. Add test cases to cover various scenarios and edge cases.

By following these steps, you can customize the `chat-agent` package to meet specific requirements or integrate additional capabilities, such as new data sources or response types.

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

`./src/chatManifest.json`, `./src/chatResponseActionSchema.ts`, `./src/chatResponseHandler.ts`, …and 2 more under `./src/`.

### Agent surface

- Manifest: [./src/chatManifest.json](./src/chatManifest.json)
- Schema: [./src/chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts)
- Handler: [./src/chatResponseHandler.ts](./src/chatResponseHandler.ts)

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
