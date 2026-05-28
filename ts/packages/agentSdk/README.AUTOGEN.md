<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=e8a9f44c7679a3f759c1f9dbe227831a3ea068321a052ac4d03fd205b5d91dc2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-sdk — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-sdk` package provides the essential interfaces and utilities for implementing a Dispatcher Agent within the TypeAgent ecosystem. It serves as the foundation for creating agents that can interact with the TypeAgent Dispatcher, handle commands, execute actions, and manage agent contexts.

## What it does

The `@typeagent/agent-sdk` package offers a comprehensive set of tools for building dispatcher agents. These tools include:

- **Manifest and Instantiation Entry Points**: Defines the agent's manifest and the entry point for instantiation.
- **Lifecycle APIs**: Methods for initializing, updating, and closing the agent context.
- **Command APIs**: Functions for defining and executing commands.
- **Action APIs**: Methods for executing actions and handling partial action streams.
- **Readiness and Setup APIs**: Functions for checking the agent's readiness and performing setup tasks.
- **Display Utilities**: Tools for managing how information is displayed to the user.

Agents built using this SDK can be registered with the TypeAgent Dispatcher and can be integrated into various TypeAgent components such as the Shell and CLI.

## Setup

To set up a dispatcher agent using the `@typeagent/agent-sdk`, you need to provide a manifest and an instantiation entry point for your agent. These are declared in the `package.json` as export paths:

- `./agent/manifest`: The location of the JSON file for the manifest.
- `./agent/handlers`: An ESM module with an instantiation entry point.

For detailed setup instructions, including how to register a dispatcher agent with the TypeAgent Dispatcher, refer to the hand-written README.

## Key Files

The internal structure of the `@typeagent/agent-sdk` package is organized into several key files:

- **[index.ts](./src/index.ts)**: Exports the main interfaces and types used throughout the SDK.
- **[action.ts](./src/action.ts)**: Defines the structure and types for actions, including `AppAction`, `ActionResult`, and `PendingChoice`.
- **[agentInterface.ts](./src/agentInterface.ts)**: Contains the core interfaces for agents, such as `AppAgent`, `SessionContext`, and `ActionContext`.
- **[command.ts](./src/command.ts)**: Provides the types and interfaces for command handling, including `CommandDescriptor`, `CommandDescriptors`, and `AppAgentCommandInterface`.
- **[display.ts](./src/display.ts)**: Defines the types for managing display content, such as `DisplayType`, `DynamicDisplay`, and `TypedDisplayContent`.
- **Helpers**: Utility functions for handling actions, commands, and display content are located in the `helpers` directory:
  - **[actionHelpers.ts](./src/helpers/actionHelpers.ts)**
  - **[commandHelpers.ts](./src/helpers/commandHelpers.ts)**
  - **[displayHelpers.ts](./src/helpers/displayHelpers.ts)**

## How to extend

To extend the functionality of a dispatcher agent using the `@typeagent/agent-sdk`, follow these steps:

1. **Implement the `AppAgent` Interface**: Start by creating a class that implements the `AppAgent` interface. This class will define the agent's behavior and lifecycle methods.

2. **Define Commands and Actions**: Implement the `getCommands` and `executeCommand` methods to define and handle commands. Similarly, implement the `executeAction` and `streamPartialAction` methods to handle actions.

3. **Manage Agent Context**: Use the `initializeAgentContext`, `updateAgentContext`, and `closeAgentContext` methods to manage the agent's context throughout its lifecycle.

4. **Handle Readiness and Setup**: Implement the `checkReadiness` and `setup` methods to manage the agent's readiness state and perform any necessary setup tasks.

5. **Utilize Display Utilities**: Use the display utilities provided in the `displayHelpers.ts` file to manage how information is displayed to the user.

6. **Test Your Agent**: Ensure your agent is functioning correctly by writing tests and running them to validate the agent's behavior.

For a practical example and initial template for building a dispatcher agent, refer to the [List agent](../agents/list/). For detailed instructions on creating agents as NPM packages, see the [tutorial](../../../docs/content/tutorial/agent.md).

By following these steps and utilizing the provided interfaces and utilities, you can extend and customize your dispatcher agent to meet specific requirements within the TypeAgent ecosystem.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./helpers/action` → [./dist/helpers/actionHelpers.js](./dist/helpers/actionHelpers.js)
- `./helpers/command` → [./dist/helpers/commandHelpers.js](./dist/helpers/commandHelpers.js)
- `./helpers/display` → [./dist/helpers/displayHelpers.js](./dist/helpers/displayHelpers.js)

### Dependencies

Workspace: _None._

External: `debug`, `type-fest`

### Used by

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/copilot-plugin](../../packages/copilot-plugin/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-shell](../../packages/shell/README.md)
- _…and 44 more workspace consumers._

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
- _…and 5 more under `./src/`._

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-sdk docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
