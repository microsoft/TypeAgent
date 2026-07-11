<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=551458cc36e6acc9d5b6d4f49536ac1d82f4262ab32d25f18f42fc8626978858 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# mcp-plan-validation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `mcp-plan-validation` package is a TypeScript library that enables plan-validated agent execution using the Model Context Protocol (MCP). It ensures that agent actions adhere to predefined organizational policies by validating and enforcing compliance through self-checking model loops. This package is designed to act as a server that mediates agent actions, ensuring they align with the approved plan and policy constraints.

## What it does

The package provides a server implementation that validates and executes plans submitted by agents. It supports a range of actions, which can be grouped into two main categories:

1. **Planning Actions**:

   - `get_plan_schema`: Retrieves the schema for creating a valid plan.
   - `submit_plan`: Submits a plan for validation and activation.
   - `plan_status`: Retrieves the current status of the active plan.
   - `plan_reset`: Resets the active plan, clearing its state.

2. **Validated Proxy Actions**:
   - `validated_read`, `validated_write`, `validated_edit`: Perform file operations (read, write, edit) while ensuring compliance with the active plan and organizational policies.
   - `validated_glob`, `validated_grep`: Perform file search and content filtering operations.
   - `validated_bash`: Executes shell commands, ensuring they comply with the active plan and policies.

The server uses the `@modelcontextprotocol/sdk` for communication, `fast-glob` for file operations, and `zod` for schema validation. It integrates with the `validation` library to enforce organizational policies, ensuring that all actions are executed within the constraints of the active plan.

## Setup

To use the `mcp-plan-validation` package, you need to configure the MCP server and set up the required environment variables. The following environment variables must be defined:

- `MCP_SERVER_COMMAND`: The command to start the MCP server.
- `MCP_SERVER_ARGS`: Arguments to pass to the MCP server command.
- `ORG_POLICY_PATH`: The file path to the organizational policy JSON file.

You can find detailed instructions for obtaining and configuring these values in the hand-written README. Additionally, the `init` command provided by the package can scaffold the necessary policy and client-specific settings for tools like Claude, Copilot, or Cursor.

## Key Files

The package is organized into several key files, each with a specific role in the plan validation and execution process:

- **[index.ts](./src/index.ts)**: The main entry point for the MCP server. It initializes the server, loads the organizational policy, and sets up the communication transport.
- **[cli.ts](./src/cli.ts)**: Implements a command-line interface for initializing and running the MCP server. It supports subcommands like `init` and `serve`.
- **[executor.ts](./src/executor.ts)**: Contains implementations for file and shell operations, such as `executeRead`, `executeWrite`, and `executeBash`. These operations are validated against the active plan and organizational policies.
- **[init.ts](./src/init.ts)**: Provides a scaffolding tool to integrate plan validation into an existing project. It generates policy files and client-specific settings for tools like Claude, Copilot, and Cursor.
- **[mcpValidationTest.ts](./src/mcpValidationTest.ts)**: Implements tests to verify the server's ability to validate and enforce policies. It uses the Agent SDK for testing and observing policy enforcement.
- **[planState.ts](./src/planState.ts)**: Manages the state of plan execution, including tracking steps, bindings, and execution traces. It provides utility functions like `createPlanState` and `resetState`.
- **[server.ts](./src/server.ts)**: Implements the MCP server, exposing validated proxy tools and handling plan validation. It defines the flow for plan submission, validation, and execution.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: This file is responsible for starting the MCP server. It parses command-line arguments, loads the organizational policy, and initializes the server with the appropriate configuration.
- **[cli.ts](./src/cli.ts)**: Provides a unified entry point for the package. It handles subcommands like `init` (to scaffold a new project) and `serve` (to start the MCP server).
- **[executor.ts](./src/executor.ts)**: Implements the core logic for validated file and shell operations. Each operation is checked against the active plan and organizational policies before execution.
- **[init.ts](./src/init.ts)**: Automates the setup process for integrating plan validation into a project. It creates policy files and configures client-specific settings for various tools.
- **[mcpValidationTest.ts](./src/mcpValidationTest.ts)**: Contains tests to ensure that the MCP server enforces policies correctly. It simulates agent interactions and verifies compliance with the active plan.
- **[planState.ts](./src/planState.ts)**: Manages the execution state of plans, including the current step, completed steps, and execution trace. It provides utility functions for initializing and resetting the state.
- **[server.ts](./src/server.ts)**: The core of the package, this file implements the MCP server. It handles plan submission, validation, and execution, ensuring that all actions comply with the active plan and organizational policies.

## How to extend

To extend the functionality of the `mcp-plan-validation` package, follow these steps:

1. **Identify the area to extend**:

   - If you want to add a new validated action, start with [server.ts](./src/server.ts).
   - If you need to modify the plan execution logic, work with [planState.ts](./src/planState.ts).
   - For new file or shell operations, extend [executor.ts](./src/executor.ts).

2. **Define new actions**:

   - Add the new action to the server implementation in [server.ts](./src/server.ts).
   - Ensure the action is validated against the active plan and organizational policies.

3. **Update policy validation**:

   - If the new action requires additional policy checks, update the relevant logic in the `validation` library.

4. **Add tests**:

   - Write tests in [mcpValidationTest.ts](./src/mcpValidationTest.ts) to verify the new functionality and ensure compliance with policies.

5. **Run tests**:
   - Use the test suite to validate your changes and ensure they do not introduce regressions.

By following these steps, you can enhance the `mcp-plan-validation` package to support additional use cases and integrate new features.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter mcp-plan-validation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
