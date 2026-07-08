<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8343eb2fa0db61fd41b39a6bf2fa3a2a9cb8b2197cf23fd5fa99ee635b43ed46 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-sdk — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-sdk` package provides interfaces and utilities for building Dispatcher Agents within the TypeAgent ecosystem. It serves as the core library for creating agents that can interact with the TypeAgent Dispatcher, handle commands and actions, and manage agent-specific contexts.

## What it does

The `@typeagent/agent-sdk` package enables developers to create and manage Dispatcher Agents by providing the following capabilities:

- **Manifest and Instantiation**: Define the agent's manifest (`AppAgentManifest`) and specify an instantiation entry point for the agent. The manifest includes metadata such as the agent's emoji, description, and translator configuration.
- **Lifecycle Management**: Implement lifecycle methods like `initializeAgentContext`, `updateAgentContext`, and `closeAgentContext` to manage the agent's runtime state and resources.
- **Command Handling**: Define commands using `CommandDescriptors` and implement methods like `getCommands` and `executeCommand` to handle user commands routed by the Dispatcher.
- **Action Execution**: Implement `executeAction` and `streamPartialAction` to handle actions triggered by the Dispatcher. These methods allow agents to process user requests and provide results or stream partial responses.
- **Readiness and Setup**: Use `checkReadiness` to determine if the agent is ready to operate and `setup` to guide users through any required configuration steps.
- **Display Management**: Leverage utilities for managing how information is displayed to users, including support for dynamic and periodic updates.

This package is used by a wide range of TypeAgent components, including the Shell, CLI, and other agents, making it a critical part of the ecosystem.

## Setup

To set up a Dispatcher Agent using the `@typeagent/agent-sdk`, you need to define two key components in your `package.json`:

1. **Manifest**: Specify the path to the agent's manifest file under the `./agent/manifest` export path. The manifest is a JSON file that includes metadata about the agent, such as its emoji, description, and translator configuration. Refer to the `AppAgentManifest` type for details on the required structure.

2. **Instantiation Entry Point**: Define the path to the agent's instantiation entry point under the `./agent/handlers` export path. This entry point should export an `instantiate` function that returns an instance of the `AppAgent` interface.

For additional guidance on registering a Dispatcher Agent with the TypeAgent Dispatcher, consult the hand-written README.

## Key Files

The `@typeagent/agent-sdk` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point for the package, exporting core interfaces and types.
- **[action.ts](./src/action.ts)**: Defines the structure and types for actions, including `AppAction`, `ActionResult`, and `PendingChoice`. These are essential for implementing the `executeAction` and `streamPartialAction` methods.
- **[agentInterface.ts](./src/agentInterface.ts)**: Contains the primary interfaces for agents, such as `AppAgent`, `SessionContext`, and `ActionContext`. These interfaces define the contract between the agent and the Dispatcher.
- **[command.ts](./src/command.ts)**: Provides types and interfaces for command handling, including `CommandDescriptor`, `CommandDescriptors`, and `AppAgentCommandInterface`. These are used to define and execute commands.
- **[display.ts](./src/display.ts)**: Defines types for managing display content, such as `DisplayType`, `DynamicDisplay`, and `TypedDisplayContent`. These are used to control how information is presented to users.
- **Helpers**: A set of utility functions for common tasks:
  - **[actionHelpers.ts](./src/helpers/actionHelpers.ts)**: Utilities for creating and managing action results.
  - **[commandHelpers.ts](./src/helpers/commandHelpers.ts)**: Functions for handling commands and their parameters.
  - **[displayHelpers.ts](./src/helpers/displayHelpers.ts)**: Tools for managing display content and formatting.
  - **[choiceManager.ts](./src/helpers/choiceManager.ts)**: Manages user choices and callbacks, enabling interactive workflows.

## How to extend

To extend the functionality of a Dispatcher Agent using the `@typeagent/agent-sdk`, follow these steps:

1. **Implement the `AppAgent` Interface**: Create a class that implements the `AppAgent` interface. This class will define the agent's behavior, including lifecycle, command, and action handling methods.

2. **Define the Manifest**: Create a JSON file that adheres to the `AppAgentManifest` type. This file should include metadata about the agent, such as its emoji, description, and translator configuration.

3. **Handle Commands**: Use the `getCommands` method to define the commands your agent supports. Implement the `executeCommand` method to handle these commands when invoked by the Dispatcher.

4. **Handle Actions**: Implement the `executeAction` and `streamPartialAction` methods to process actions routed by the Dispatcher. Use the `actionHelpers.ts` utilities to simplify the creation of action results.

5. **Manage Context**: Use the `initializeAgentContext`, `updateAgentContext`, and `closeAgentContext` methods to manage the agent's runtime context. This context can store state information that persists across multiple calls.

6. **Implement Readiness and Setup**: Define the `checkReadiness` method to report the agent's readiness state. If setup is required, implement the `setup` method to guide users through the configuration process.

7. **Leverage Display Utilities**: Use the utilities in `displayHelpers.ts` to manage how information is displayed to users. This includes support for dynamic and periodic updates.

8. **Test Your Agent**: Write and run tests to ensure your agent behaves as expected. Use the provided interfaces and utilities to simplify testing.

For a practical example, refer to the [List agent](../agents/list/), which serves as a template for building Dispatcher Agents. Additional resources and tutorials are available in the TypeAgent documentation.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- `./helpers/action` → `./dist/helpers/actionHelpers.js` _(not found on disk)_
- `./helpers/command` → `./dist/helpers/commandHelpers.js` _(not found on disk)_
- `./helpers/display` → `./dist/helpers/displayHelpers.js` _(not found on disk)_
- `./node` → `./dist/node/cliPath.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)

External: `debug`, `type-fest`

### Used by

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/copilot-plugin](../../packages/copilot-plugin/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-shell](../../packages/shell/README.md)
- [android-mobile-agent](../../packages/agents/androidMobile/README.md)
- _…and 47 more workspace consumers._

### Files of interest

- [./src/index.ts](./src/index.ts)
- [./src/action.ts](./src/action.ts)
- [./src/agentInterface.ts](./src/agentInterface.ts)
- [./src/command.ts](./src/command.ts)
- [./src/display.ts](./src/display.ts)
- [./src/helpers/actionHelpers.ts](./src/helpers/actionHelpers.ts)
- [./src/helpers/choiceManager.ts](./src/helpers/choiceManager.ts)
- [./src/helpers/commandHelpers.ts](./src/helpers/commandHelpers.ts)
- [./src/helpers/displayHelpers.ts](./src/helpers/displayHelpers.ts)
- [./src/helpers/parameterHelpers.ts](./src/helpers/parameterHelpers.ts)
- _…and 6 more under `./src/`._

---

_Auto-generated against commit `ff379b098decfab4eb45f78b6fa318358d7fbd75` on `2026-07-01T09:05:58.471Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-sdk docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
