<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=c1833fc7a143e126699af834ea4d0bc3a636617b2a6e8a20e4ec7a47c66ecfc3 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# greeting-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Greeting Agent is a sample TypeAgent application designed to generate personalized greeting messages using structured prompting and a language model (LLM). It demonstrates how to use schemas to obtain structured responses from the LLM and how to enhance these responses with personalized information using web search engines.

## What it does

The Greeting Agent accepts actions related to generating greeting messages. Specifically, it handles the `personalizedGreetingAction`, which involves creating varied and spontaneous greetings that convey different moods such as friendly, enthusiastic, excited, polite, cheerful, and more. The agent can generate multiple greeting options and select one at random, ensuring that the responses are diverse in tone, length, cadence, delivery, and style. Additionally, the agent can incorporate chat history into the greetings to make them more personalized.

The agent uses a web search engine, such as Bing, to augment the generated responses with personalized information. If a Bing API key is provided, the agent can perform lookups to enhance the greetings. Otherwise, it will return a generic "No Information available" response.

## Setup

To experiment with lookups using the Greeting Agent, you need to add your Bing API key to the root `.env` file with the following key:

```text
BING_API_KEY
```

If a Bing API key is not available, the agent will still function but will return a generic response when personalized information is required. For detailed setup instructions, see the hand-written README.

## Key Files

The Greeting Agent's architecture consists of several key components:

- **Manifest**: The [greetingManifest.json](./src/greetingManifest.json) file defines the agent's metadata, including its description and emoji character.
- **Schema**: The [greetingActionSchema.ts](./src/greetingActionSchema.ts) file defines the structure of the actions the agent can handle, specifically the `personalizedGreetingAction`.
- **Handler**: The [greetingCommandHandler.ts](./src/greetingCommandHandler.ts) file contains the logic for handling the `personalizedGreetingAction`. It includes functions for initializing the agent context, generating greeting responses, and performing web lookups.

The agent uses the `@typeagent/agent-sdk` for core functionalities, `aiclient` for interacting with the language model, and `knowledge-processor` for managing conversation context.

### Key Files

- **[greetingManifest.json](./src/greetingManifest.json)**: Contains metadata about the agent.
- **[greetingActionSchema.ts](./src/greetingActionSchema.ts)**: Defines the structure and types for greeting actions.
- **[greetingCommandHandler.ts](./src/greetingCommandHandler.ts)**: Implements the logic for handling greeting actions and generating responses.

## How to extend

To extend the Greeting Agent, follow these steps:

1. **Open the handler file**: Start by examining the [greetingCommandHandler.ts](./src/greetingCommandHandler.ts) file. This file contains the main logic for handling actions and generating responses.
2. **Add new actions**: If you want to introduce new types of greeting actions, update the [greetingActionSchema.ts](./src/greetingActionSchema.ts) file to define the structure of the new actions.
3. **Implement new handlers**: Create new functions in the [greetingCommandHandler.ts](./src/greetingCommandHandler.ts) file to handle the new actions. Ensure that these functions follow the existing pattern of initializing context, generating responses, and performing lookups if necessary.
4. **Test your changes**: Run the agent and test the new actions to ensure they work as expected. You can use the existing test framework or add new tests to cover the new functionalities.

By following these steps, you can extend the Greeting Agent to handle additional types of greeting actions or enhance its existing capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/greetingManifest.json](./src/greetingManifest.json)
- `./agent/handlers` → [./dist/greetingCommandHandler.js](./dist/greetingCommandHandler.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [aiclient](../../../packages/aiclient/README.md)
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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter greeting-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
