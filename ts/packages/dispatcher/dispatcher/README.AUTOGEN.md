<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=856ee53d7457715ec98a6b8ac1b5aee8a019607f326ad4da734150e46b87ed50 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-dispatcher — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The TypeAgent Dispatcher is a core component of the TypeAgent repository that facilitates the creation of personal agents with natural language interfaces using structured prompting and large language models (LLMs). It can be integrated and hosted in various front ends, such as the TypeAgent Shell and TypeAgent CLI, and supports an extensible application agents architecture.

## What it does

The Dispatcher processes user requests and translates them into actions based on schemas provided by application agents. It can automatically switch between different agents to provide a cohesive experience. The Dispatcher supports natural language requests and system commands, enabling users to interact with the system in a flexible manner.

### Natural Language Requests

Users can request actions provided by application agents using natural language. For example, in the CLI:

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

### Commands

Users can specify system commands with inputs starting with `@`. Examples include toggling dispatcher agents, configuring explainers, and managing conversations.

## Setup

The Dispatcher requires several environment variables to be set for proper operation:

- `CLAUDE_CUSTOM_PROMPT_FILE`
- `CLAUDE_FORCE_REASONING`
- `COPILOT_REASONING_EFFORT`
- `COPILOT_REASONING_MODEL`
- `COSMOSDB_CONNECTION_STRING`
- `INSTANCE_NAME`
- `TYPEAGENT_REASONING_TIMEOUT_MS`
- `TYPEAGENT_REQUEST_ACTION_LOG_DIR`
- `TYPEAGENT_USER_DATA_DIR`

Refer to the hand-written README for detailed instructions on obtaining and setting these values.

## Key Files

The Dispatcher is organized into several key components:

- **Handlers**: Located in [./src/context/dispatcher/handlers/](./src/context/dispatcher/handlers/), these files handle specific commands such as [explainCommandHandler.ts](./src/context/dispatcher/handlers/explainCommandHandler.ts), [matchCommandHandler.ts](./src/context/dispatcher/handlers/matchCommandHandler.ts), [reasonCommandHandler.ts](./src/context/dispatcher/handlers/reasonCommandHandler.ts), [requestCommandHandler.ts](./src/context/dispatcher/handlers/requestCommandHandler.ts), and [translateCommandHandler.ts](./src/context/dispatcher/handlers/translateCommandHandler.ts).
- **Schemas**: Located in [./src/context/dispatcher/schema/](./src/context/dispatcher/schema/), these files define the structure of actions, including [activityActionSchema.ts](./src/context/dispatcher/schema/activityActionSchema.ts), [clarifyActionSchema.ts](./src/context/dispatcher/schema/clarifyActionSchema.ts), [dispatcherActionSchema.ts](./src/context/dispatcher/schema/dispatcherActionSchema.ts), [lookupActionSchema.ts](./src/context/dispatcher/schema/lookupActionSchema.ts), and [reasoningActionSchema.ts](./src/context/dispatcher/schema/reasoningActionSchema.ts).
- **Helpers**: Various utility functions and classes are provided in [./src/helpers/](./src/helpers/), such as [console.ts](./src/helpers/console.ts), [userData.ts](./src/helpers/userData.ts), [userSettings.ts](./src/helpers/userSettings.ts), [config.ts](./src/helpers/config.ts), [status.ts](./src/helpers/status.ts), [command.ts](./src/helpers/command.ts), and [completion/index.ts](./src/helpers/completion/index.ts).

## How to extend

To extend the Dispatcher, follow these steps:

1. **Add a new handler**: Create a new file in [./src/context/dispatcher/handlers/](./src/context/dispatcher/handlers/) and implement the necessary logic for the new command.
2. **Define a new schema**: Create a new file in [./src/context/dispatcher/schema/](./src/context/dispatcher/schema/) to define the structure of the new action.
3. **Update the Dispatcher**: Modify the Dispatcher to recognize and process the new command and schema.
4. **Test the changes**: Ensure that the new functionality works as expected by running tests and verifying the integration with existing components.

For more detailed information on the Dispatcher architecture and design, refer to the dispatcher architecture documentation.

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

### Dependencies

Workspace:

- [@typeagent/action-schema](../../../packages/actionSchema/README.md)
- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/completion-ui](../../../packages/completionUI/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [action-grammar](../../../packages/actionGrammar/README.md)
- [agent-cache](../../../packages/cache/README.md)
- [aiclient](../../../packages/aiclient/README.md)
- [azure-ai-foundry](../../../packages/azure-ai-foundry/README.md)
- [conversation-memory](../../../packages/memory/conversation/README.md)
- [image-memory](../../../packages/memory/image/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- taskflow-typeagent
- [telemetry](../../../packages/telemetry/README.md)
- [typeagent](../../../packages/typeagent/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)
- [website-memory](../../../packages/memory/website/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `@azure/ai-agents`, `@azure/ai-projects`, `@azure/core-client`, `@azure/core-rest-pipeline`, `@azure/cosmos`, `@azure/identity`, `@github/copilot-sdk`, `chalk`, `debug`, `exifreader`, `file-size`, `glob`, `html-to-text`, `open`, `proper-lockfile`, `string-width`, `typechat`, `zod`

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
- _…and 125 more under `./src/`._

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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.407Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-dispatcher docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
