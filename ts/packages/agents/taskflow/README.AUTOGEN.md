<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=dda609dc04d2e3cc95566bb5a0a9fab73a72bf17994a76fffd3060d86051b06d -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# taskflow-typeagent â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The `taskflow-typeagent` package is a TypeAgent application agent designed to enable users to create and manage task flows. These task flows act as macros, automating sequences of TypeAgent actions based on user-taught examples. This package enhances the automation capabilities of the TypeAgent ecosystem by providing a flexible way to define, execute, and manage these task flows.

## What it does

The `taskflow-typeagent` package supports several key actions related to task flows:

- `listTaskFlows`: Lists all registered task flows.
- `deleteTaskFlow`: Deletes a specified task flow by name.

These actions allow users to manage their task flows effectively. The package also includes functionality for creating and executing task flows, validating scripts, and generating grammar patterns for natural language processing. By leveraging these capabilities, users can automate complex sequences of actions and streamline their workflows.

## Setup

To set up the `taskflow-typeagent` package, you need to configure the necessary environment variables. The package relies on the following environment variable:

- `TASKFLOW_STORE_PATH`: Path to the directory where task flow definitions are stored.

Additionally, depending on the specific integrations you plan to use, you may need to set up OAuth or API keys. For detailed setup instructions, refer to the hand-written README.

## Key Files
The `taskflow-typeagent` package is organized into several key components:

- **Schema**: The task flow schema is defined in [taskflowSchema.agr](./src/taskflowSchema.agr) and [userActions.mts](./src/schema/userActions.mts). These files specify the structure and types of task flow actions.
- **Handlers**: The main action handler is implemented in [actionHandler.mts](./src/actionHandler.mts). This file contains the logic for executing task flow actions and managing the task flow store.
- **Script Execution**: Task flow scripts are managed and executed using several files, including [taskFlowScriptApi.mts](./src/script/taskFlowScriptApi.mts), [taskFlowScriptExecutor.mts](./src/script/taskFlowScriptExecutor.mts), and [taskFlowScriptValidator.mts](./src/script/taskFlowScriptValidator.mts).
- **Grammar Generation**: Grammar patterns for task flows are generated using [grammarGenerator.ts](./src/grammarGenerator.ts). This file includes logic for creating natural language patterns based on task flow definitions.

## How to extend

To extend the `taskflow-typeagent` package, follow these steps:

1. **Define New Actions**: Add new action types to [userActions.mts](./src/schema/userActions.mts). Ensure that each action has a unique name and appropriate parameters.
2. **Update Schema**: Modify [taskflowSchema.agr](./src/taskflowSchema.agr) to include grammar patterns for the new actions. This will enable natural language processing for the new actions.
3. **Implement Handlers**: Extend the logic in [actionHandler.mts](./src/actionHandler.mts) to handle the new actions. Implement the necessary functions to execute the actions and manage their results.
4. **Test**: Write tests to validate the new actions and their integration with the existing task flow system. Ensure that the new actions work as expected and do not introduce any regressions.

By following these steps, you can add new functionality to the `taskflow-typeagent` package and enhance its capabilities.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` â†’ [./manifest.json](./manifest.json)
- `./agent/handlers` â†’ [./dist/actionHandler.mjs](./dist/actionHandler.mjs)
- `./recipe` â†’ [./dist/types/recipe.js](./dist/types/recipe.js)

### Dependencies

Workspace:

- [@typeagent/agent-flows](../../../packages/agent-flows/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `debug`, `typescript`

### Used by

- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

- [./src/taskflowSchema.agr](./src/taskflowSchema.agr)
- [./src/actionHandler.mts](./src/actionHandler.mts)
- [./src/grammarGenerator.ts](./src/grammarGenerator.ts)
- [./src/schema/userActions.json](./src/schema/userActions.json)
- [./src/schema/userActions.mts](./src/schema/userActions.mts)
- [./src/script/sandboxDeclarations.mts](./src/script/sandboxDeclarations.mts)
- [./src/script/taskFlowSandbox.d.ts](./src/script/taskFlowSandbox.d.ts)
- [./src/script/taskFlowScriptApi.mts](./src/script/taskFlowScriptApi.mts)
- [./src/script/taskFlowScriptExecutor.mts](./src/script/taskFlowScriptExecutor.mts)
- [./src/script/taskFlowScriptValidator.mts](./src/script/taskFlowScriptValidator.mts)
- _â€¦and 5 more under `./src/`._

### Agent surface

- Grammar: [./src/taskflowSchema.agr](./src/taskflowSchema.agr)

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:26.515Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter taskflow-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
