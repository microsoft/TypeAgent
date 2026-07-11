<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=49e09d4b91a24c9fd317cd3475692d6e1d1fbd361801db2dcad8677b5918b721 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# chat-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `chat-agent` package is a TypeAgent application agent designed to handle conversational interactions. It serves as a sample implementation for building a typed chat agent that leverages structured prompting and large language models (LLMs). The agent uses a schema-driven approach to generate structured responses and can perform external lookups, such as web searches, to provide additional information when needed.

This package is part of the TypeAgent monorepo and integrates with other agents and utilities to deliver a cohesive conversational experience. It is often used alongside other agents like the `default-agent-provider`, `greeting-agent`, and `settings-agent`.

## What it does

The `chat-agent` provides a framework for handling natural language interactions using structured schemas and LLMs. It supports the following key actions:

- **`generateResponse`**: Generates a response based on the provided context or known information. This action is used for general conversation, answering questions, and providing explanations. It can also perform lookups using external data sources, such as Bing, to fetch supplementary information when required.
- **`showImageFile`**: Displays images based on file entities provided in the request. This action retrieves and rehydrates image files from storage and includes them in the response.

The agent is designed to handle scenarios where additional information is required to respond to user queries. If no external data source is configured or available, the agent will return a "No Information available" response.

The `chat-agent` demonstrates how to use schemas to enforce structured responses from LLMs, ensuring that the output adheres to predefined formats. This approach enables the agent to handle complex interactions, such as performing lookups for additional information, and ensures that responses are consistent and type-safe.

## Setup

To enable the full functionality of the `chat-agent`, including its ability to perform external lookups, you need to configure a Bing API key. Follow these steps:

1. Obtain a Bing API key from the Bing developer portal.
2. Add the key to one of the following configuration files:
   - If using `config.local.yaml`, add the key under the `bing.apiKey` field.
   - Alternatively, add the key to a `.env` file with the key name `BING_API_KEY`.

If the Bing API key is not provided, the agent will still function but will return a "No Information available" response when a lookup is required.

## Key Files

The `chat-agent` package is organized into several key files that define its structure and functionality:

- **[chatManifest.json](./src/chatManifest.json)**: This file serves as the agent's manifest. It provides metadata about the agent, including its description, the schema it uses, and the actions it supports. It also specifies whether actions are cached or streamed.

- **[chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts)**: This file defines the structured schema for the agent's actions. It includes type definitions for actions like `GenerateResponseAction` and `ShowImageFileAction`, ensuring that all interactions are type-safe and consistent.

- **[chatResponseHandler.ts](./src/chatResponseHandler.ts)**: This file contains the core logic for handling actions and generating responses. Key functions include:

  - `executeChatResponseAction`: Processes actions such as `generateResponse` and `showImageFile`.
  - `rehydrateImages`: Retrieves and formats image files for the `showImageFile` action.
  - Integration with external data sources, such as Bing, for performing lookups.

- **[index.ts](./src/index.ts)**: The main entry point for the package. It exports the agent instantiation function and key action execution functions, making them accessible to other parts of the system.

## How to extend

The `chat-agent` package is designed to be extensible, allowing contributors to add new actions, modify existing ones, or integrate additional data sources. Here are the steps to extend the package:

1. **Understand the existing structure**: Familiarize yourself with the key files, especially [chatResponseHandler.ts](./src/chatResponseHandler.ts) and [chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts). These files define the agent's core logic and schema.

2. **Define new actions**:

   - Add new action types to [chatResponseActionSchema.ts](./src/chatResponseActionSchema.ts). Ensure the new actions are well-typed and follow the existing schema conventions.
   - For example, if you want to add an action for fetching weather data, define a new action type like `FetchWeatherAction` with appropriate parameters.

3. **Implement action handling**:

   - Add the logic for handling the new actions in [chatResponseHandler.ts](./src/chatResponseHandler.ts). Use the existing patterns for executing actions and generating responses as a guide.
   - For instance, you might create a function `handleFetchWeatherAction` to process the new action and integrate with a weather API.

4. **Update the manifest**:

   - Modify [chatManifest.json](./src/chatManifest.json) to include the new actions and update the schema if necessary. This ensures the agent recognizes and supports the new functionality.

5. **Test your changes**:

   - Write unit tests to verify the new actions and their handling logic. Ensure that the tests cover various scenarios and edge cases.
   - Run the tests to confirm that your changes work as expected.

6. **Document your changes**:
   - Update the documentation to include details about the new actions and their usage. This will help other contributors understand and use your additions.

By following these steps, you can extend the `chat-agent` package to meet specific requirements or integrate new capabilities, such as additional data sources, response types, or custom actions.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter chat-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
