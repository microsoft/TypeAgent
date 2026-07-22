<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=008b8d6df8b9be4259bfa82491fa5c7da47c81ae217db19b00fb8061b027579a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-dispatcher — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The TypeAgent Dispatcher is a TypeScript library that acts as the central component of the TypeAgent ecosystem. It processes user inputs, translates natural language into structured actions using large language models (LLMs), and coordinates interactions across various application agents. The Dispatcher is designed to integrate with multiple front ends, such as the TypeAgent Shell and CLI, and supports an extensible architecture for building personal agents with natural language interfaces.

## What it does

The Dispatcher provides a framework for interpreting user inputs and orchestrating actions across different agents. It supports both natural language requests and system commands, enabling a wide range of interactions.

### Natural Language Requests

The Dispatcher leverages LLMs to process natural language inputs and translate them into structured actions defined by application agent schemas. For example:

```bash
[calendar]🤖> can you setup a meeting between 2-3PM
Generating translation using GPT for 'can you setup a meeting between 2-3PM'
🤖: can you setup a meeting between 2-3PM => addEvent({"event":{"day":"today","timeRange":["14:00","15:00"],"description":"meeting"}}) [9.531s]
Accept? (y/n)
```

Other examples include:

- `play some music by Bach for me please`
- `create a grocery list`
- `add milk to the grocery list`

### System Commands

System commands prefixed with `@` allow users to configure and interact with the Dispatcher directly. Key commands include:

- **Agent Management**: Enable or disable specific agents or groups of agents.

  - `@config agent <agent>`: Enable a specific agent.
  - `@config agent --off <agent>`: Disable a specific agent.
  - `@config agent *`: Enable all agents.
  - `@config agent --reset`: Reset agent configurations to default.

- **Explainer Configuration**: Configure the explainer used for interpreting translations.

  - `@config explainer name <explainer>`: Set the explainer to a specific implementation.
  - `@config explainer`: List all available explainers.

- **Shortcut Commands**: Directly invoke specific parts of the Dispatcher system.
  - `@translate <request>`: Perform only the translation step.
  - `@explain <request> => <action>`: Generate an explanation for a request-action pair.
  - `@reasoning [--engine claude|copilot|none] <request>`: Use the reasoning engine on a request.

### Conversation Management

The Dispatcher supports managing conversations through natural language or system commands. Examples include:

- "Create a new conversation called research."
- "Switch to my work conversation."
- "List my conversations."
- "Rename this conversation to project notes."

The Dispatcher translates these requests into structured payloads and forwards them to the client for execution.

## Setup

To configure the Dispatcher, the following environment variables must be set:

- `CLAUDE_CUSTOM_PROMPT_FILE`: Path to a custom prompt file for Claude.
- `CLAUDE_FORCE_REASONING`: Boolean flag to enforce reasoning with Claude.
- `COPILOT_REASONING_EFFORT`: Effort level for Copilot reasoning.
- `COPILOT_REASONING_MODEL`: Model identifier for Copilot reasoning.
- `COSMOSDB_CONNECTION_STRING`: Connection string for Azure Cosmos DB.
- `INSTANCE_NAME`: Name of the current instance.
- `TYPEAGENT_REASONING_TIMEOUT_MS`: Timeout for reasoning operations in milliseconds.
- `TYPEAGENT_REQUEST_ACTION_LOG_DIR`: Directory for logging request actions.
- `TYPEAGENT_USER_DATA_DIR`: Directory for storing user data.

Refer to the hand-written README for additional details on obtaining and setting these values.

## Key Files

The Dispatcher is organized into several key components, each with specific responsibilities:

### Handlers

Handlers process specific commands and are located in [./src/context/dispatcher/handlers/](./src/context/dispatcher/handlers/). Key files include:

- [explainCommandHandler.ts](./src/context/dispatcher/handlers/explainCommandHandler.ts): Handles the `@explain` command.
- [matchCommandHandler.ts](./src/context/dispatcher/handlers/matchCommandHandler.ts): Handles matching-related commands.
- [reasonCommandHandler.ts](./src/context/dispatcher/handlers/reasonCommandHandler.ts): Handles reasoning commands.
- [requestCommandHandler.ts](./src/context/dispatcher/handlers/requestCommandHandler.ts): Handles user requests.
- [translateCommandHandler.ts](./src/context/dispatcher/handlers/translateCommandHandler.ts): Handles the `@translate` command.

### Schemas

Schemas define the structure of actions and are located in [./src/context/dispatcher/schema/](./src/context/dispatcher/schema/). Key files include:

- [activityActionSchema.ts](./src/context/dispatcher/schema/activityActionSchema.ts): Defines schemas for activity-related actions.
- [clarifyActionSchema.ts](./src/context/dispatcher/schema/clarifyActionSchema.ts): Defines schemas for clarification actions.
- [dispatcherActionSchema.ts](./src/context/dispatcher/schema/dispatcherActionSchema.ts): Defines schemas for dispatcher-specific actions.
- [lookupActionSchema.ts](./src/context/dispatcher/schema/lookupActionSchema.ts): Defines schemas for lookup actions.

### Helpers

Utility functions and classes are provided in [./src/helpers/](./src/helpers/). Notable files include:

- [console.ts](./src/helpers/console.ts): Console-related utilities.
- [userData.ts](./src/helpers/userData.ts): Manages user data.
- [userSettings.ts](./src/helpers/userSettings.ts): Handles user settings.
- [config.ts](./src/helpers/config.ts): Configuration utilities.
- [status.ts](./src/helpers/status.ts): Status-related utilities.
- [command.ts](./src/helpers/command.ts): Command-related utilities.
- [completion/index.ts](./src/helpers/completion/index.ts): Handles command completion logic.

## How to extend

To extend the Dispatcher, follow these steps:

1. **Add a New Handler**:

   - Create a new file in [./src/context/dispatcher/handlers/](./src/context/dispatcher/handlers/).
   - Implement the logic for the new command or action.

2. **Define a New Schema**:

   - Add a new file in [./src/context/dispatcher/schema/](./src/context/dispatcher/schema/).
   - Define the structure of the new action or command.

3. **Update the Dispatcher**:

   - Modify the Dispatcher to recognize and process the new handler and schema.
   - Ensure the new functionality integrates with existing components.

4. **Test Your Changes**:

   - Write unit tests for the new functionality.
   - Use the CLI or Shell to validate the integration in real-world scenarios.

5. **Documentation**:
   - Update the hand-written README or other relevant documentation to reflect the new functionality.

For more details on the architecture and design of the Dispatcher, refer to the dispatcher architecture documentation.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./helpers/console` → [./dist/helpers/console.js](./dist/helpers/console.js)
- `./helpers/data` → [./dist/helpers/userData.js](./dist/helpers/userData.js)
- `./helpers/userSettings` → [./dist/helpers/userSettings.js](./dist/helpers/userSettings.js)
- `./helpers/config` → [./dist/helpers/config.js](./dist/helpers/config.js)
- `./helpers/status` → [./dist/helpers/status.js](./dist/helpers/status.js)
- `./helpers/command` → [./dist/helpers/command.js](./dist/helpers/command.js)
- `./helpers/completion` → [./dist/helpers/completion/index.js](./dist/helpers/completion/index.js)
- `./internal` → [./dist/internal.js](./dist/internal.js)
- `./explorer` → [./dist/explorer.js](./dist/explorer.js)
- `./contextSelector` → [./dist/context/contextSelector/index.js](./dist/context/contextSelector/index.js)

### Dependencies

Workspace:

- [@typeagent/action-grammar](../../../packages/actionGrammar/README.md)
- [@typeagent/action-schema](../../../packages/actionSchema/README.md)
- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/completion-ui](../../../packages/completionUI/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [agent-cache](../../../packages/cache/README.md)
- [azure-ai-foundry](../../../packages/azure-ai-foundry/README.md)
- [conversation-memory](../../../packages/memory/conversation/README.md)
- grammar-tools-core
- [image-memory](../../../packages/memory/image/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- taskflow-typeagent
- [telemetry](../../../packages/telemetry/README.md)
- [typeagent](../../../packages/typeagent/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)
- [website-memory](../../../packages/memory/website/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `@azure/core-client`, `@azure/core-rest-pipeline`, `@azure/cosmos`, `@azure/identity`, `@github/copilot-sdk`, `chalk`, `debug`, `exifreader`, `file-size`, `glob`, `html-to-text`, `open`, `proper-lockfile`, `string-width`, `typechat`, `zod`

### Used by

- [@typeagent/action-browser](../../../tools/actionBrowser/README.md)
- [@typeagent/docs-autogen](../../../tools/docsAutogen/README.md)
- [agent-api](../../../packages/api/README.md)
- [agent-cache-explorer](../../../packages/cacheExplorer/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [cache-rest-endpoint](../../../examples/cacheRESTEndpoint/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- [dispatcher-node-providers](../../../packages/dispatcher/nodeProviders/README.md)
- _…and 8 more workspace consumers._

### Files of interest

- [./src/context/contextSelector/index.ts](./src/context/contextSelector/index.ts)
- [./src/context/dispatcher/handlers/explainCommandHandler.ts](./src/context/dispatcher/handlers/explainCommandHandler.ts)
- [./src/context/dispatcher/handlers/matchCommandHandler.ts](./src/context/dispatcher/handlers/matchCommandHandler.ts)
- [./src/context/dispatcher/handlers/reasonCommandHandler.ts](./src/context/dispatcher/handlers/reasonCommandHandler.ts)
- [./src/context/dispatcher/handlers/requestCommandHandler.ts](./src/context/dispatcher/handlers/requestCommandHandler.ts)
- [./src/context/dispatcher/handlers/translateCommandHandler.ts](./src/context/dispatcher/handlers/translateCommandHandler.ts)
- [./src/context/dispatcher/schema/activityActionSchema.ts](./src/context/dispatcher/schema/activityActionSchema.ts)
- [./src/context/dispatcher/schema/clarifyActionSchema.ts](./src/context/dispatcher/schema/clarifyActionSchema.ts)
- [./src/context/dispatcher/schema/dispatcherActionSchema.ts](./src/context/dispatcher/schema/dispatcherActionSchema.ts)
- [./src/context/dispatcher/schema/lookupActionSchema.ts](./src/context/dispatcher/schema/lookupActionSchema.ts)
- _…and 212 more under `./src/`._

### Environment variables

_9 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `CLAUDE_CUSTOM_PROMPT_FILE`
- `CLAUDE_FORCE_REASONING`
- `COPILOT_REASONING_EFFORT`
- `COPILOT_REASONING_MODEL`
- `COSMOSDB_CONNECTION_STRING`
- `INSTANCE_NAME`
- `TYPEAGENT_REASONING_TIMEOUT_MS`
- `TYPEAGENT_REQUEST_ACTION_LOG_DIR`
- `TYPEAGENT_USER_DATA_DIR`

---

_Auto-generated against commit `7a11b23d16147030224c419ae79127abeab4d2d0` on `2026-07-22T08:22:39.862Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-dispatcher docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
