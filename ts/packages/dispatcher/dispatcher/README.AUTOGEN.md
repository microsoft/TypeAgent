<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=42833e0c199b4b57aac358cd064a07d4895aefec1b9899d53b1600c04f30ee5a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-dispatcher — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The TypeAgent Dispatcher is a core component of the TypeAgent repository, designed to facilitate the creation and operation of personal agents with natural language interfaces. By leveraging structured prompting and large language models (LLMs), the Dispatcher enables users to interact with application agents through natural language requests and system commands. It integrates with various front ends, such as the TypeAgent Shell and TypeAgent CLI, and supports an extensible architecture for application agents.

## What it does

The Dispatcher serves as the central hub for processing user requests and translating them into structured actions. It works in conjunction with application agents, which provide schemas that define the structure of these actions. The Dispatcher can dynamically switch between agents to handle different types of requests, making it adaptable to a wide range of use cases.

### Natural Language Requests

The Dispatcher allows users to issue natural language requests, which are then translated into structured actions. For example, in the CLI:

```bash
[calendar]🤖> can you setup a meeting between 2-3PM
Generating translation using GPT for 'can you setup a meeting between 2-3PM'
🤖: can you setup a meeting between 2-3PM => addEvent({"event":{"day":"today","timeRange":["14:00","15:00"],"description":"meeting"}}) [9.531s]
Accept? (y/n)
```

Other examples of natural language requests include:

- `play some music by Bach for me please`
- `create a grocery list`
- `add milk to the grocery list`

### System Commands

In addition to natural language, the Dispatcher supports system commands that begin with `@`. These commands allow users to interact directly with the system. Examples include:

- **Toggling Dispatcher Agents**: Enable or disable specific agents or groups of agents using commands like `@config agent <agent>` or `@config agent --off <agent>`.
- **Configuring Explainers**: Change the explainer implementation used by the Dispatcher with commands like `@config explainer name <explainer>`.
- **Managing Conversations**: Use commands such as `@conversation` to create, switch, rename, or delete conversations.

### Reasoning and Explanation

The Dispatcher can invoke reasoning engines like Claude or Copilot to process complex requests. Users can specify the reasoning engine with commands like `@reasoning [--engine claude|copilot|none] <request>`. Additionally, the Dispatcher can generate explanations for the actions it translates, which can be configured using the `@config explainer` command.

### Session Management

The Dispatcher supports session management, allowing users to persist settings and data across sessions. For example, session data such as construction stores can be saved and restored automatically. Session files are stored in the user's home directory under `.typeagent/profiles/<profile>/sessions/<name>`.

## Setup

To use the Dispatcher, the following environment variables must be configured:

- `CLAUDE_CUSTOM_PROMPT_FILE`: Path to a custom prompt file for the Claude reasoning engine.
- `CLAUDE_FORCE_REASONING`: Boolean flag to enforce the use of Claude for reasoning.
- `COPILOT_REASONING_EFFORT`: Specifies the effort level for Copilot reasoning.
- `COPILOT_REASONING_MODEL`: Defines the model to use for Copilot reasoning.
- `COSMOSDB_CONNECTION_STRING`: Connection string for Azure Cosmos DB.
- `INSTANCE_NAME`: Name of the instance for identification purposes.
- `TYPEAGENT_REASONING_TIMEOUT_MS`: Timeout (in milliseconds) for reasoning operations.
- `TYPEAGENT_REQUEST_ACTION_LOG_DIR`: Directory path for logging request actions.
- `TYPEAGENT_USER_DATA_DIR`: Directory path for storing user data.

Refer to the hand-written README for detailed instructions on obtaining and setting these values.

## Key Files

The Dispatcher is implemented with a modular structure, with key files organized into specific directories:

- **Handlers**: These files manage the execution of specific commands and are located in [./src/context/dispatcher/handlers/](./src/context/dispatcher/handlers/). Examples include:

  - [explainCommandHandler.ts](./src/context/dispatcher/handlers/explainCommandHandler.ts): Handles requests for explanations of actions.
  - [matchCommandHandler.ts](./src/context/dispatcher/handlers/matchCommandHandler.ts): Manages matching-related commands.
  - [reasonCommandHandler.ts](./src/context/dispatcher/handlers/reasonCommandHandler.ts): Handles reasoning-related commands.
  - [requestCommandHandler.ts](./src/context/dispatcher/handlers/requestCommandHandler.ts): Processes user requests.
  - [translateCommandHandler.ts](./src/context/dispatcher/handlers/translateCommandHandler.ts): Handles translation of natural language into structured actions.

- **Schemas**: These files define the structure of actions and are located in [./src/context/dispatcher/schema/](./src/context/dispatcher/schema/). Examples include:

  - [activityActionSchema.ts](./src/context/dispatcher/schema/activityActionSchema.ts): Defines schemas for activity-related actions.
  - [clarifyActionSchema.ts](./src/context/dispatcher/schema/clarifyActionSchema.ts): Handles schemas for clarification actions.
  - [dispatcherActionSchema.ts](./src/context/dispatcher/schema/dispatcherActionSchema.ts): Core schema definitions for dispatcher actions.
  - [lookupActionSchema.ts](./src/context/dispatcher/schema/lookupActionSchema.ts): Defines schemas for lookup actions.
  - [reasoningActionSchema.ts](./src/context/dispatcher/schema/reasoningActionSchema.ts): Handles schemas for reasoning actions.

- **Helpers**: Utility functions and classes are located in [./src/helpers/](./src/helpers/). Key files include:
  - [console.ts](./src/helpers/console.ts): Provides console-related utilities.
  - [userData.ts](./src/helpers/userData.ts): Manages user data operations.
  - [userSettings.ts](./src/helpers/userSettings.ts): Handles user settings.
  - [config.ts](./src/helpers/config.ts): Manages configuration settings.
  - [status.ts](./src/helpers/status.ts): Tracks and reports system status.
  - [command.ts](./src/helpers/command.ts): Handles command parsing and execution.
  - [completion/index.ts](./src/helpers/completion/index.ts): Manages command completion logic.

## How to extend

To extend the functionality of the Dispatcher, follow these steps:

1. **Create a New Handler**: Add a new file in [./src/context/dispatcher/handlers/](./src/context/dispatcher/handlers/) and implement the logic for the new command. Use existing handlers as a reference for structure and patterns.
2. **Define a New Schema**: Add a new schema file in [./src/context/dispatcher/schema/](./src/context/dispatcher/schema/) to define the structure of the new action. Ensure the schema aligns with the expected input and output of the action.
3. **Update the Dispatcher**: Modify the Dispatcher to recognize the new command and schema. This may involve updating configuration files or modifying existing logic to integrate the new functionality.
4. **Test Your Changes**: Write and run tests to verify that the new functionality works as intended. Use the existing test suite as a guide for creating new test cases.
5. **Document Your Changes**: Update the documentation to include details about the new functionality, including any new commands, schemas, or configuration options.

For additional guidance, refer to the dispatcher architecture documentation and the hand-written README. These resources provide a deeper understanding of the Dispatcher's design and integration points.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- `./helpers/console` → `./dist/helpers/console.js` _(not found on disk)_
- `./helpers/data` → `./dist/helpers/userData.js` _(not found on disk)_
- `./helpers/userSettings` → `./dist/helpers/userSettings.js` _(not found on disk)_
- `./helpers/config` → `./dist/helpers/config.js` _(not found on disk)_
- `./helpers/status` → `./dist/helpers/status.js` _(not found on disk)_
- `./helpers/command` → `./dist/helpers/command.js` _(not found on disk)_
- `./helpers/completion` → `./dist/helpers/completion/index.js` _(not found on disk)_
- `./internal` → `./dist/internal.js` _(not found on disk)_
- `./explorer` → `./dist/explorer.js` _(not found on disk)_

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

- [agent-api](../../../packages/api/README.md)
- [agent-cache-explorer](../../../packages/cacheExplorer/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [cache-rest-endpoint](../../../examples/cacheRESTEndpoint/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- [dispatcher-node-providers](../../../packages/dispatcher/nodeProviders/README.md)
- [greeting-agent](../../../packages/agents/greeting/README.md)
- [knowledgevisualizer](../../../packages/knowledgeVisualizer/README.md)
- _…and 6 more workspace consumers._

### Files of interest

- [./src/context/dispatcher/handlers/explainCommandHandler.ts](./src/context/dispatcher/handlers/explainCommandHandler.ts)
- [./src/context/dispatcher/handlers/matchCommandHandler.ts](./src/context/dispatcher/handlers/matchCommandHandler.ts)
- [./src/context/dispatcher/handlers/reasonCommandHandler.ts](./src/context/dispatcher/handlers/reasonCommandHandler.ts)
- [./src/context/dispatcher/handlers/requestCommandHandler.ts](./src/context/dispatcher/handlers/requestCommandHandler.ts)
- [./src/context/dispatcher/handlers/translateCommandHandler.ts](./src/context/dispatcher/handlers/translateCommandHandler.ts)
- [./src/context/dispatcher/schema/activityActionSchema.ts](./src/context/dispatcher/schema/activityActionSchema.ts)
- [./src/context/dispatcher/schema/clarifyActionSchema.ts](./src/context/dispatcher/schema/clarifyActionSchema.ts)
- [./src/context/dispatcher/schema/dispatcherActionSchema.ts](./src/context/dispatcher/schema/dispatcherActionSchema.ts)
- [./src/context/dispatcher/schema/lookupActionSchema.ts](./src/context/dispatcher/schema/lookupActionSchema.ts)
- [./src/context/dispatcher/schema/reasoningActionSchema.ts](./src/context/dispatcher/schema/reasoningActionSchema.ts)
- _…and 185 more under `./src/`._

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-dispatcher docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
