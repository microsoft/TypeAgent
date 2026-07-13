<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=57eb42789e6b72cbc2e15a492c9fa8c7e44be8cad052c63205db9bdf342f2f3d -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# greeting-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Greeting Agent is a sample TypeAgent application designed to generate personalized and varied greeting messages using structured prompting and a language model (LLM). It demonstrates how to use schemas to structure LLM responses and how to enhance these responses with personalized information, such as details retrieved from a web search engine. This agent serves as a practical example of building a typed agent that combines LLM capabilities with external data sources to create engaging and context-aware interactions.

## What it does

The Greeting Agent is built around the `personalizedGreetingAction`, which enables the generation of multiple greeting options tailored to the user's context. These greetings vary in tone, length, cadence, delivery, and style, and can incorporate chat history to make them more relevant and personalized.

### Key Features

1. **Structured Responses**: The agent uses a schema defined in [greetingActionSchema.ts](./src/greetingActionSchema.ts) to ensure that the LLM generates structured and consistent outputs. This schema specifies the parameters and expected format of the `personalizedGreetingAction`.

2. **Diverse Greetings**: The agent generates multiple greeting options that vary in tone and style, such as friendly, enthusiastic, polite, cheerful, or lively. It also includes greetings that are appropriate for the time of day or day of the week, and may incorporate phrases from languages other than English.

3. **Randomized Selection**: From the generated options, the agent selects one greeting at random, ensuring that responses remain dynamic and engaging.

4. **Personalized Augmentation**: The agent can enhance greetings with personalized information retrieved from a web search engine, such as Bing. This allows the agent to provide contextually relevant and enriched responses. If a Bing API key is not provided, the agent defaults to a generic "No Information available" response.

This functionality makes the Greeting Agent a versatile tool for exploring the integration of structured prompting, LLMs, and external data sources.

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

The Greeting Agent is implemented using a modular architecture, with each file playing a specific role in the agent's functionality. Below are the key files and their responsibilities:

- **[greetingManifest.json](./src/greetingManifest.json)**: Contains metadata about the agent, including its description and an emoji character that represents it. This file is essential for registering the agent within the TypeAgent ecosystem.

- **[greetingActionSchema.ts](./src/greetingActionSchema.ts)**: Defines the schema for the `personalizedGreetingAction`. This schema specifies the input parameters (e.g., the original user request and possible greeting responses) and the expected structure of the LLM-generated output. It ensures that the agent produces consistent and well-formed responses.

- **[greetingCommandHandler.ts](./src/greetingCommandHandler.ts)**: Implements the logic for handling the `personalizedGreetingAction`. Key responsibilities include:
  - Initializing the agent's context, such as user-specific data.
  - Generating multiple greeting options using the LLM.
  - Integrating with a web search engine (e.g., Bing) to augment greetings with personalized information.

These files work together to define the agent's behavior, from its metadata and action schema to the logic for processing actions and generating responses.

## How to extend

The Greeting Agent is designed to be extensible, allowing contributors to add new actions, enhance existing ones, or modify its behavior. Below are the steps to extend the agent:

1. **Understand the Existing Structure**:

   - Review the [greetingActionSchema.ts](./src/greetingActionSchema.ts) file to understand the current action schema and its parameters.
   - Familiarize yourself with the [greetingCommandHandler.ts](./src/greetingCommandHandler.ts) file, which contains the logic for handling actions and integrating with external data sources.

2. **Add New Actions**:

   - Define the structure of the new action in the [greetingActionSchema.ts](./src/greetingActionSchema.ts) file. Ensure the schema includes all necessary parameters and specifies the expected response format.

3. **Implement New Handlers**:

   - Extend the [greetingCommandHandler.ts](./src/greetingCommandHandler.ts) file with new functions to handle the new actions. Follow the existing patterns for initializing context, generating responses, and performing lookups.

4. **Update the Manifest**:

   - Modify the [greetingManifest.json](./src/greetingManifest.json) file to include metadata for the new actions, such as their names and descriptions.

5. **Test Your Changes**:
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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter greeting-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
