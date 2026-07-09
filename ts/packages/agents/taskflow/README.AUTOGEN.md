<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=7223aadc58fc8d03fa098d1c67f2992beae96fbe12d8df5636901dad70970c3e -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# taskflow-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `taskflow-typeagent` package is a TypeAgent application agent that allows users to create, manage, and execute task flows. These task flows act as user-defined macros, enabling the automation of sequences of TypeAgent actions. This package is designed to help users define reusable workflows, simplifying complex tasks and enhancing productivity within the TypeAgent ecosystem.

## What it does

The `taskflow-typeagent` package provides tools for creating, managing, and executing task flows. Task flows are user-taught macros that consist of sequences of actions, which can be triggered programmatically or through natural language commands. The package includes the following key actions:

- `listTaskFlows`: Retrieves a list of all registered task flows, allowing users to view and manage their workflows.
- `deleteTaskFlow`: Removes a specified task flow by name, enabling users to clean up or reorganize their task flow library.

The package also includes features for defining task flows using natural language patterns, validating task flow scripts, and executing them in a controlled environment. It integrates with other TypeAgent components, such as `@typeagent/agent-flows` and `@typeagent/agent-sdk`, to provide a cohesive framework for automation.

## Setup

To use the `taskflow-typeagent` package, you need to configure the following environment variable:

- `TASKFLOW_STORE_PATH`: This variable specifies the directory where task flow definitions are stored. Ensure that the specified path is accessible and writable by the application.

For additional setup instructions, such as configuring integrations or external dependencies, refer to the hand-written README.

## Key Files

The `taskflow-typeagent` package is organized into several key files, each serving a specific purpose:

- **Schema and Grammar**:

  - [taskflowSchema.agr](./src/taskflowSchema.agr): Defines the grammar for task flow actions, including natural language patterns for actions like `listTaskFlows` and `deleteTaskFlow`.
  - [userActions.mts](./src/schema/userActions.mts): Specifies the structure and types of task flow actions, such as `ListTaskFlows` and `DeleteTaskFlow`.

- **Action Handling**:

  - [actionHandler.mts](./src/actionHandler.mts): Contains the core logic for executing task flow actions, managing the task flow store, and handling user-taught macros.

- **Script Management**:

  - [taskFlowScriptApi.mts](./src/script/taskFlowScriptApi.mts): Provides an API for interacting with task flow scripts, including invoking actions and querying external services.
  - [taskFlowScriptExecutor.mts](./src/script/taskFlowScriptExecutor.mts): Manages the execution of task flow scripts.
  - [taskFlowScriptValidator.mts](./src/script/taskFlowScriptValidator.mts): Validates task flow scripts to ensure they adhere to the defined schema and grammar.

- **Grammar Generation**:

  - [grammarGenerator.ts](./src/grammarGenerator.ts): Implements logic for generating natural language grammar patterns for task flow actions, with optional support for language model (LLM) assistance.

- **Sandbox Declarations**:
  - [sandboxDeclarations.mts](./src/script/sandboxDeclarations.mts): Generates type declarations for the task flow script sandbox environment.
  - [taskFlowSandbox.d.ts](./src/script/taskFlowSandbox.d.ts): Provides static type declarations for the task flow script sandbox, ensuring type safety during script execution.

## How to extend

To extend the `taskflow-typeagent` package, follow these steps:

1. **Define New Actions**:

   - Add new action types to [userActions.mts](./src/schema/userActions.mts). Each action should have a unique name and clearly defined parameters.

2. **Update the Grammar**:

   - Modify [taskflowSchema.agr](./src/taskflowSchema.agr) to include natural language patterns for the new actions. This ensures that the actions can be triggered using user-friendly commands.

3. **Implement Action Handlers**:

   - Extend the logic in [actionHandler.mts](./src/actionHandler.mts) to handle the new actions. Implement the necessary functionality to execute the actions and process their results.

4. **Enhance Script Support**:

   - If the new actions require additional script functionality, update [taskFlowScriptApi.mts](./src/script/taskFlowScriptApi.mts) and [taskFlowScriptExecutor.mts](./src/script/taskFlowScriptExecutor.mts) to support the new behavior.

5. **Test Your Changes**:
   - Write unit tests to validate the new actions and their integration with the existing task flow system. Ensure that the new functionality works as expected and does not introduce regressions.

By following these steps, you can expand the capabilities of the `taskflow-typeagent` package to meet specific requirements or use cases.

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
- [./src/schema/userActions.keywords.json](./src/schema/userActions.keywords.json)
- [./src/schema/userActions.mts](./src/schema/userActions.mts)
- [./src/script/sandboxDeclarations.mts](./src/script/sandboxDeclarations.mts)
- [./src/script/taskFlowSandbox.d.ts](./src/script/taskFlowSandbox.d.ts)
- [./src/script/taskFlowScriptApi.mts](./src/script/taskFlowScriptApi.mts)
- [./src/script/taskFlowScriptExecutor.mts](./src/script/taskFlowScriptExecutor.mts)
- _…and 6 more under `./src/`._

### Agent surface

- Grammar: [./src/taskflowSchema.agr](./src/taskflowSchema.agr)

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter taskflow-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
