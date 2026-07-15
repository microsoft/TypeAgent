<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f5fd2d2abb7f28846acf237767baaa631747485a099cf7665b47dd207d1fb327 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-sdk — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-sdk` package provides the core interfaces, types, and utilities required to build and manage Dispatcher Agents in the TypeAgent ecosystem. It serves as the foundational library for creating agents that interact with the TypeAgent Dispatcher, enabling them to handle user commands, execute actions, and manage their lifecycle and context.

This package is widely used across the TypeAgent ecosystem, including in the Shell, CLI, and other agents, making it a critical component for agent development and integration.

## What it does

The `@typeagent/agent-sdk` package offers a comprehensive set of tools and interfaces to facilitate the development of Dispatcher Agents. Its key features include:

### Manifest and Instantiation

- **Manifest**: The `AppAgentManifest` defines metadata about the agent, such as its emoji, description, and translator configuration. This manifest is loaded by the Dispatcher when the agent is initialized.
- **Instantiation Entry Point**: The `AppAgent` interface is the core contract that agents implement. The Dispatcher uses the `instantiate` function exported from the `./agent/handlers` module to create an instance of the agent.

### Lifecycle Management

- **initializeAgentContext**: Sets up the agent's runtime context, which is passed back in subsequent API calls.
- **updateAgentContext**: Updates the agent's context, such as enabling or disabling specific actions or sub-schemas.
- **closeAgentContext**: Cleans up resources when the agent is no longer needed.

### Command Handling

- **getCommands**: Returns a list of commands (`CommandDescriptors`) that the agent supports.
- **executeCommand**: Executes commands based on parsed parameters provided by the Dispatcher.

### Action Execution

- **executeAction**: Handles user-triggered actions routed by the Dispatcher. The agent is responsible for further routing to specific handlers.
- **streamPartialAction**: Supports streaming partial results for actions, such as generating responses incrementally.

### Readiness and Setup

- **checkReadiness**: Reports the agent's readiness state, indicating whether it is ready, requires setup, or is unsupported.
- **setup**: Provides an optional in-chat configuration flow to guide users through the setup process and transition the agent to a ready state.

### Display Management

- **Dynamic and Periodic Updates**: Utilities for managing how information is displayed to users, including support for dynamic and periodic updates.

### Choice Management

- **handleChoice**: Routes user responses to the agent's `ChoiceManager`, enabling interactive workflows.

## Setup

To create a Dispatcher Agent using the `@typeagent/agent-sdk`, follow these steps:

1. **Define the Manifest**:

   - Create a JSON file that adheres to the `AppAgentManifest` type. This file should include metadata about the agent, such as its emoji, description, and translator configuration.
   - Specify the path to this file in your `package.json` under the `./agent/manifest` export path.

2. **Implement the Instantiation Entry Point**:

   - Create a TypeScript or JavaScript file that implements the `AppAgent` interface.
   - Export an `instantiate` function from this file, which returns an instance of the `AppAgent`.
   - Specify the path to this file in your `package.json` under the `./agent/handlers` export path.

3. **Follow Examples**:
   - Refer to the [List agent](../agents/list/) as a practical example of building a Dispatcher Agent.
   - Consult the Dispatcher README for instructions on registering your agent with the TypeAgent Dispatcher.

## Key Files

The `@typeagent/agent-sdk` package is organized into several key files, each with a specific role in the development of Dispatcher Agents:

- **[index.ts](./src/index.ts)**: The main entry point, exporting core interfaces, types, and utilities for building agents.
- **[action.ts](./src/action.ts)**: Defines the structure and types for actions, including `AppAction`, `ActionResult`, and `PendingChoice`. These are essential for implementing action-related methods like `executeAction`.
- **[agentInterface.ts](./src/agentInterface.ts)**: Contains the primary interfaces for agents, such as `AppAgent`, `SessionContext`, and `ActionContext`. These define the contract between the agent and the Dispatcher.
- **[command.ts](./src/command.ts)**: Provides types and interfaces for command handling, including `CommandDescriptor` and `CommandDescriptors`. These are used to define and execute commands.
- **[display.ts](./src/display.ts)**: Defines types for managing display content, such as `DisplayType` and `DynamicDisplay`. These are used to control how information is presented to users.

### Helper Modules

- **[actionHelpers.ts](./src/helpers/actionHelpers.ts)**: Utilities for creating and managing action results.
- **[commandHelpers.ts](./src/helpers/commandHelpers.ts)**: Functions for handling commands and their parameters.
- **[displayHelpers.ts](./src/helpers/displayHelpers.ts)**: Tools for managing display content and formatting.
- **[choiceManager.ts](./src/helpers/choiceManager.ts)**: Manages user choices and callbacks, enabling interactive workflows.

### Node-Specific Utilities

- **[cliPath.ts](./src/node/cliPath.ts)**: Node.js-specific helpers for resolving CLI paths, re-exported from `@typeagent/common-utils`.

## How to extend

To extend the functionality of a Dispatcher Agent using the `@typeagent/agent-sdk`, follow these steps:

1. **Implement the `AppAgent` Interface**:

   - Create a class that implements the `AppAgent` interface. This class will define the agent's behavior, including lifecycle, command, and action handling methods.

2. **Define the Manifest**:

   - Create a JSON file that adheres to the `AppAgentManifest` type. Include metadata about the agent, such as its emoji, description, and translator configuration.

3. **Handle Commands**:

   - Use the `getCommands` method to define the commands your agent supports.
   - Implement the `executeCommand` method to handle these commands when invoked by the Dispatcher.

4. **Handle Actions**:

   - Implement the `executeAction` and `streamPartialAction` methods to process actions routed by the Dispatcher.
   - Use the utilities in `actionHelpers.ts` to simplify the creation of action results.

5. **Manage Context**:

   - Use the `initializeAgentContext`, `updateAgentContext`, and `closeAgentContext` methods to manage the agent's runtime context. This context can store state information that persists across multiple calls.

6. **Implement Readiness and Setup**:

   - Define the `checkReadiness` method to report the agent's readiness state.
   - If setup is required, implement the `setup` method to guide users through the configuration process.

7. **Leverage Display Utilities**:

   - Use the utilities in `displayHelpers.ts` to manage how information is displayed to users. This includes support for dynamic and periodic updates.

8. **Test Your Agent**:
   - Write and run tests to ensure your agent behaves as expected. Use the provided interfaces and utilities to simplify testing.

For inspiration and practical examples, refer to the [List agent](../agents/list/) or other agents in the TypeAgent ecosystem. These examples demonstrate how to implement various features and integrate with the Dispatcher.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./helpers/action` → [./dist/helpers/actionHelpers.js](./dist/helpers/actionHelpers.js)
- `./helpers/command` → [./dist/helpers/commandHelpers.js](./dist/helpers/commandHelpers.js)
- `./helpers/display` → [./dist/helpers/displayHelpers.js](./dist/helpers/displayHelpers.js)
- `./node` → [./dist/node/cliPath.js](./dist/node/cliPath.js)

### Dependencies

Workspace:

- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)

External: `debug`, `type-fest`

### Used by

- [@typeagent/action-browser](../../tools/actionBrowser/README.md)
- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/copilot-plugin](../../packages/copilot-plugin/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- [@typeagent/echo](../../examples/agentExamples/echo/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- _…and 48 more workspace consumers._

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

_Auto-generated against commit `f928ce70269b7d0f8942977c29147b2c8832b722` on `2026-07-15T22:42:29.947Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-sdk docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
