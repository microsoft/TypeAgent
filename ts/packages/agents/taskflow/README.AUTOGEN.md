<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=815c59b52d8627e69b68910db21131a573150675a03d3f911b0632aa24f03b97 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# taskflow-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `taskflow-typeagent` package is a TypeAgent application agent that enables users to create, manage, and execute task flows. These task flows function as user-taught macros, allowing for the automation of sequences of TypeAgent actions. By leveraging this package, users can define reusable workflows that streamline complex tasks and improve efficiency within the TypeAgent ecosystem.

## What it does

The `taskflow-typeagent` package provides functionality for managing task flows, which are user-defined sequences of actions. It supports the following key actions:

- `listTaskFlows`: Retrieves a list of all registered task flows, allowing users to view the available workflows.
- `deleteTaskFlow`: Removes a specified task flow by name, enabling users to manage and clean up their task flow library.

In addition to these actions, the package includes tools for creating, validating, and executing task flows. It integrates with natural language processing (NLP) capabilities to generate grammar patterns, enabling users to define task flows using intuitive, human-readable commands. The package also provides a script execution environment, allowing task flows to be executed programmatically.

This package interacts with other components in the TypeAgent ecosystem, such as `@typeagent/agent-flows` and `@typeagent/agent-sdk`, to provide a cohesive automation framework.

## Setup

To use the `taskflow-typeagent` package, you need to configure the following environment variable:

- `TASKFLOW_STORE_PATH`: Specifies the directory where task flow definitions are stored. Ensure this path is accessible and writable by the application.

If additional setup steps, such as OAuth or API key configuration, are required for specific integrations, refer to the hand-written README for detailed instructions.

## Key Files

The `taskflow-typeagent` package is organized into several key files, each responsible for specific functionality:

- **Schema Definition**:

  - [taskflowSchema.agr](./src/taskflowSchema.agr): Defines the grammar for task flow actions, including natural language patterns for actions like `listTaskFlows` and `deleteTaskFlow`.
  - [userActions.mts](./src/schema/userActions.mts): Specifies the structure and types of task flow actions, such as `ListTaskFlows` and `DeleteTaskFlow`.

- **Action Handlers**:

  - [actionHandler.mts](./src/actionHandler.mts): Implements the logic for executing task flow actions, managing the task flow store, and handling user-taught macros.

- **Script Management**:

  - [taskFlowScriptApi.mts](./src/script/taskFlowScriptApi.mts): Provides an API for interacting with task flow scripts, including calling actions and querying external services.
  - [taskFlowScriptExecutor.mts](./src/script/taskFlowScriptExecutor.mts): Handles the execution of task flow scripts.
  - [taskFlowScriptValidator.mts](./src/script/taskFlowScriptValidator.mts): Validates task flow scripts to ensure they conform to the defined schema and grammar.

- **Grammar Generation**:

  - [grammarGenerator.ts](./src/grammarGenerator.ts): Contains logic for generating natural language grammar patterns for task flow actions, optionally using a language model (LLM) for assistance.

- **Sandbox Declarations**:
  - [sandboxDeclarations.mts](./src/script/sandboxDeclarations.mts): Generates type declarations for the task flow script sandbox environment.
  - [taskFlowSandbox.d.ts](./src/script/taskFlowSandbox.d.ts): Provides static type declarations for the task flow script sandbox, ensuring type safety during script execution.

## How to extend

To extend the functionality of the `taskflow-typeagent` package, follow these steps:

1. **Add New Actions**:

   - Define new action types in [userActions.mts](./src/schema/userActions.mts). Each action should have a unique name and clearly defined parameters.

2. **Update the Schema**:

   - Modify [taskflowSchema.agr](./src/taskflowSchema.agr) to include grammar patterns for the new actions. This step ensures that the new actions can be triggered using natural language commands.

3. **Implement Action Handlers**:

   - Extend the logic in [actionHandler.mts](./src/actionHandler.mts) to handle the new actions. Implement the necessary functions to execute the actions and manage their results.

4. **Enhance Script Support**:

   - If the new actions require additional script functionality, update [taskFlowScriptApi.mts](./src/script/taskFlowScriptApi.mts) and [taskFlowScriptExecutor.mts](./src/script/taskFlowScriptExecutor.mts) to support the new behavior.

5. **Test Your Changes**:
   - Write unit tests to validate the new actions and their integration with the existing task flow system. Ensure that the new functionality works as intended and does not introduce regressions.

By following these steps, you can customize the `taskflow-typeagent` package to meet specific requirements and expand its capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./manifest.json](./manifest.json)
- `./agent/handlers` → `./dist/actionHandler.mjs` _(not found on disk)_
- `./recipe` → `./dist/types/recipe.js` _(not found on disk)_

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
- _…and 5 more under `./src/`._

### Agent surface

- Grammar: [./src/taskflowSchema.agr](./src/taskflowSchema.agr)

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter taskflow-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
