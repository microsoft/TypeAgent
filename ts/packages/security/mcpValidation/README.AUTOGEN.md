<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=551458cc36e6acc9d5b6d4f49536ac1d82f4262ab32d25f18f42fc8626978858 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# mcp-plan-validation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `mcp-plan-validation` package is a TypeScript library that enables plan-validated agent execution using the Model Context Protocol (MCP). It ensures that agent actions adhere to predefined organizational policies by validating plans and enforcing self-checking model loops. This package is designed to act as a server that mediates agent actions, ensuring compliance with the specified policies and execution plans.

## What it does

The primary function of this package is to validate and execute plans submitted by agents. It provides a set of validated proxy tools and actions that are checked against the active plan and organizational policies before execution. The supported actions include:

- **Planning-related actions**: `get_plan_schema`, `submit_plan`, `plan_status`, and `plan_reset`. These actions allow agents to interact with the server to retrieve schemas, submit plans, check the status of plans, and reset plans.
- **Validated proxy tools**: Actions such as `validated_read`, `validated_write`, `validated_edit`, `validated_glob`, `validated_grep`, and `validated_bash` enable agents to perform file and shell operations. Each action is validated against the current plan step and organizational policies to ensure compliance.

The package integrates with the `validation` library to enforce organizational policies and uses the `@modelcontextprotocol/sdk` for server communication. It also leverages `fast-glob` for file operations and `zod` for schema validation.

## Setup

To use the `mcp-plan-validation` package, you need to configure the environment and provide the necessary dependencies. The following environment variables must be set:

- `MCP_SERVER_COMMAND`: The command to start the MCP server.
- `MCP_SERVER_ARGS`: Arguments to pass to the MCP server command.
- `ORG_POLICY_PATH`: The file path to the organizational policy JSON file.

You can find detailed instructions for obtaining and configuring these values in the hand-written README. Additionally, if you are integrating this package with tools like Claude, Copilot, or Cursor, you may need to configure client-specific settings.

## Key Files

The package is organized into several key files, each with a specific role in the plan validation and execution process:

- **[index.ts](./src/index.ts)**: The main entry point for the MCP server. It initializes the server, loads the organizational policy, and sets up the communication transport.
- **[cli.ts](./src/cli.ts)**: Provides a command-line interface for initializing and serving the MCP server. It handles subcommands like `init` and `serve`.
- **[executor.ts](./src/executor.ts)**: Implements the core logic for file and shell operations, such as `executeRead` and `executeWrite`, which are validated against the active plan and policies.
- **[init.ts](./src/init.ts)**: A utility for scaffolding the plan validation setup into an existing project. It generates necessary policy files and client-specific settings.
- **[mcpValidationTest.ts](./src/mcpValidationTest.ts)**: Contains tests to verify that the MCP server correctly validates and enforces policies. It uses the Agent SDK for testing and validation.
- **[planState.ts](./src/planState.ts)**: Manages the state of plan execution, including tracking steps, bindings, and execution traces. It provides utility functions like `createPlanState` and `resetState`.
- **[server.ts](./src/server.ts)**: Implements the MCP server, exposing validated proxy tools and handling the flow of plan validation and execution.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: This file is the starting point for the MCP server. It parses command-line arguments, loads the organizational policy, and initializes the server with the appropriate configuration.
- **[cli.ts](./src/cli.ts)**: Handles command-line arguments and routes them to the appropriate modules. For example, the `init` subcommand invokes the [init.ts](./src/init.ts) module, while the `serve` subcommand starts the MCP server.
- **[executor.ts](./src/executor.ts)**: Contains the implementation of validated file and shell operations. These operations are executed only if they comply with the active plan and organizational policies.
- **[init.ts](./src/init.ts)**: Scaffolds the plan validation setup by creating policy files and configuring client-specific settings. It supports multiple clients, including Claude, Copilot, and Cursor.
- **[mcpValidationTest.ts](./src/mcpValidationTest.ts)**: Implements tests to ensure that the MCP server enforces policies correctly. It uses the Agent SDK to simulate agent interactions and validate the server's behavior.
- **[planState.ts](./src/planState.ts)**: Manages the state of plan execution, including the current step, completed steps, and execution trace. It provides utility functions for initializing and resetting the state.
- **[server.ts](./src/server.ts)**: The core of the MCP server, this file defines the flow for plan submission, validation, and execution. It also exposes the validated proxy tools and ensures that all actions comply with the active plan and policies.

## How to extend

To extend the functionality of the `mcp-plan-validation` package, follow these steps:

1. **Identify the area to extend**: Determine which aspect of the package you want to modify or enhance. For example, you might want to add a new validated action or modify the policy validation logic.

2. **Modify the relevant file**:

   - To add a new validated action, start with [server.ts](./src/server.ts). Define the new action and ensure it is validated against the active plan and policies.
   - If the new action requires additional policy checks, update the policy validation logic in the `validation` library.

3. **Update the plan state management**: If your changes involve new plan states or transitions, update [planState.ts](./src/planState.ts) to handle the new logic.

4. **Add tests**: Write tests in [mcpValidationTest.ts](./src/mcpValidationTest.ts) to verify that your changes are correctly implemented and do not break existing functionality.

5. **Run tests**: Use the test suite to ensure that your changes work as expected and do not introduce regressions.

By following these steps, you can effectively extend the `mcp-plan-validation` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- validation

External: `@modelcontextprotocol/sdk`, `fast-glob`, `zod`

### Used by

- [plan-validation-demo](../../../examples/planValidationDemo/README.md)

### Files of interest

`./src/index.ts`, `./src/cli.ts`, `./src/executor.ts`, …and 4 more under `./src/`.

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter mcp-plan-validation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
