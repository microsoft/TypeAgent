<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=57eb42789e6b72cbc2e15a492c9fa8c7e44be8cad052c63205db9bdf342f2f3d -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# greeting-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Greeting Agent is a sample TypeAgent application designed to generate personalized and varied greeting messages using structured prompting and a language model (LLM). It demonstrates how to use schemas to structure LLM responses and how to enhance these responses with personalized information, such as details retrieved from a web search engine. This agent serves as a practical example of building a typed agent with structured prompting, integrating external data sources, and generating diverse, context-aware responses.

## What it does

The Greeting Agent handles the `personalizedGreetingAction`, which enables it to generate multiple greeting options that vary in tone, length, cadence, delivery, and style. These greetings can convey a range of moods, such as friendly, enthusiastic, polite, cheerful, or lively. The agent also supports incorporating chat history into the generated greetings to make them more personalized and contextually relevant.

Key features include:

- **Structured Responses**: The agent uses the schema defined in [greetingActionSchema.ts](./src/greetingActionSchema.ts) to ensure that the LLM generates structured and well-defined responses.
- **Randomized Selection**: The agent generates multiple greeting options and selects one at random, ensuring diversity in the responses.
- **Personalized Augmentation**: By integrating with a web search engine like Bing, the agent can enhance greetings with personalized information. If a Bing API key is not provided, the agent defaults to a generic "No Information available" response.

This agent is a demonstration of how to combine LLM capabilities with external data sources to create engaging and context-aware interactions.

## Setup

To enable the Greeting Agent's full functionality, including personalized lookups, you need to configure a Bing API key. Follow these steps:

1. Obtain a Bing API key from the Microsoft Azure portal.
2. Add the API key to the root `.env` file with the following entry:
   ```text
   BING_API_KEY=your_bing_api_key
   ```
   Alternatively, you can add the key to the `config.local.yaml` file under the `bing.apiKey` field.

If no Bing API key is provided, the agent will still function but will return a generic "No Information available" response when personalized data is required. For more details, refer to the hand-written README.

## Key Files

The Greeting Agent is implemented using a modular architecture, with each component responsible for a specific aspect of the agent's functionality. The key files include:

- **[greetingManifest.json](./src/greetingManifest.json)**: This file contains metadata about the agent, such as its description and an emoji character that represents it.
- **[greetingActionSchema.ts](./src/greetingActionSchema.ts)**: This file defines the structure of the `personalizedGreetingAction`, including the parameters and expected response format. It ensures that the LLM generates structured and consistent outputs.
- **[greetingCommandHandler.ts](./src/greetingCommandHandler.ts)**: This file implements the logic for handling the `personalizedGreetingAction`. It includes:
  - Initialization of the agent's context.
  - Functions for generating greeting responses.
  - Integration with a web search engine for personalized lookups.

The agent also relies on several dependencies, including `@typeagent/agent-sdk` for core agent functionalities, `@typeagent/aiclient` for LLM interactions, and `knowledge-processor` for managing conversation context.

## How to extend

To extend the Greeting Agent, you can add new actions, enhance existing ones, or modify the agent's behavior. Here are the steps to get started:

1. **Understand the existing structure**:

   - Review the [greetingActionSchema.ts](./src/greetingActionSchema.ts) file to understand the current action schema.
   - Familiarize yourself with the [greetingCommandHandler.ts](./src/greetingCommandHandler.ts) file, which contains the logic for handling actions.

2. **Add new actions**:

   - Define the structure of the new action in the [greetingActionSchema.ts](./src/greetingActionSchema.ts) file. Ensure the schema includes all necessary parameters and expected response formats.

3. **Implement new handlers**:

   - Add new functions to the [greetingCommandHandler.ts](./src/greetingCommandHandler.ts) file to handle the new actions. Follow the existing patterns for initializing context, generating responses, and performing lookups.

4. **Update the manifest**:

   - Modify the [greetingManifest.json](./src/greetingManifest.json) file to include metadata for the new actions.

5. **Test your changes**:
   - Use the existing test framework to validate your changes. Add new test cases to cover the new functionalities and ensure they work as expected.

By following these steps, you can customize the Greeting Agent to meet specific requirements or expand its capabilities to handle additional types of interactions.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/greetingManifest.json](./src/greetingManifest.json)
- `./agent/handlers` → `./dist/greetingCommandHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [chat-agent](../../../packages/agents/chat/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `debug`, `typechat`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/greetingActionSchema.ts`, `./src/greetingCommandHandler.ts`, `./src/greetingManifest.json`, …and 1 more under `./src/`.

### Agent surface

- Manifest: [./src/greetingManifest.json](./src/greetingManifest.json)
- Schema: [./src/greetingActionSchema.ts](./src/greetingActionSchema.ts)
- Handler: [./src/greetingCommandHandler.ts](./src/greetingCommandHandler.ts)

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter greeting-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
