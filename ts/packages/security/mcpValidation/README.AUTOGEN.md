<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=551458cc36e6acc9d5b6d4f49536ac1d82f4262ab32d25f18f42fc8626978858 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# mcp-plan-validation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `mcp-plan-validation` package is a TypeScript library that enables plan-validated agent execution using the Model Context Protocol (MCP). It ensures that agent actions adhere to organizational policies by validating plans and enforcing self-checking model loops. This package is particularly useful for scenarios where strict compliance with predefined policies is required during agent operations.

## What it does

The primary function of this package is to provide a server that validates and executes plans submitted by agents. It ensures that all actions performed by agents are compliant with the active plan and organizational policies. The package supports a range of actions, including:

- **Planning-related actions**: `get_plan_schema`, `submit_plan`, `plan_status`, and `plan_reset`. These actions allow agents to retrieve the schema for creating plans, submit plans for validation, check the status of a plan, and reset the current plan.
- **Validated proxy actions**: `validated_read`, `validated_write`, `validated_edit`, `validated_glob`, `validated_grep`, and `validated_bash`. These actions enable agents to perform file and shell operations that are validated against the active plan and organizational policies.

The package integrates with the `validation` library to enforce organizational policies and uses the `@modelcontextprotocol/sdk` for server communication. It also leverages `fast-glob` for file operations and `zod` for schema validation.

## Setup

To use the `mcp-plan-validation` package, you need to configure the environment and provide necessary inputs. The following environment variables must be set:

- `MCP_SERVER_COMMAND`: The command to start the MCP server.
- `MCP_SERVER_ARGS`: Arguments to pass to the MCP server command.
- `ORG_POLICY_PATH`: The file path to the organizational policy JSON file.

You can find detailed instructions for obtaining and setting these values in the hand-written README. Additionally, if you are integrating this package with tools like Claude, Copilot, or Cursor, you may need to configure client-specific settings.

## Key Files

The package is organized into several key files, each with a specific role in the plan validation and execution process:

- **[index.ts](./src/index.ts)**: The main entry point for the MCP server. It initializes the server, loads the organizational policy, and sets up the communication transport.
- **[cli.ts](./src/cli.ts)**: Implements a command-line interface for initializing and running the MCP server. It supports subcommands like `init` and `serve`.
- **[executor.ts](./src/executor.ts)**: Contains implementations for file and shell operations that are validated against the active plan and organizational policies. Examples include `executeRead` and `executeWrite`.
- **[init.ts](./src/init.ts)**: Scaffolds the plan validation setup into an existing project. It generates necessary policy files and client-specific settings.
- **[mcpValidationTest.ts](./src/mcpValidationTest.ts)**: Provides tests to verify that the MCP server correctly validates and enforces policies. It uses the Agent SDK for testing and validation.
- **[planState.ts](./src/planState.ts)**: Manages the state of plan execution, including tracking steps, bindings, and execution traces. It provides utility functions like `createPlanState` and `resetState`.
- **[server.ts](./src/server.ts)**: Implements the MCP server, exposing validated proxy tools and handling the entire flow of plan validation and execution.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: Initializes the MCP server and loads the organizational policy. It also sets up the `StdioServerTransport` for communication.
- **[cli.ts](./src/cli.ts)**: Routes subcommands to the appropriate modules. For example, the `init` subcommand invokes the initialization script, while the `serve` subcommand starts the MCP server.
- **[executor.ts](./src/executor.ts)**: Implements validated file and shell operations. For instance, `executeRead` reads a file while adhering to the active plan's constraints, and `executeWrite` ensures that file writes comply with organizational policies.
- **[init.ts](./src/init.ts)**: Automates the setup of plan validation in a project. It creates policy files, client-specific settings, and other necessary configurations.
- **[mcpValidationTest.ts](./src/mcpValidationTest.ts)**: Tests the MCP server's ability to validate and enforce policies. It simulates agent interactions and verifies that the server behaves as expected.
- **[planState.ts](./src/planState.ts)**: Handles the internal state of plan execution, including the current step, completed steps, and execution trace. It ensures that the state is consistent and can be reset or initialized as needed.
- **[server.ts](./src/server.ts)**: The core of the package, this file defines the MCP server's behavior. It validates and executes plans, manages the flow of actions, and ensures compliance with organizational policies.

## How to extend

To extend the functionality of the `mcp-plan-validation` package, follow these steps:

1. **Identify the area to extend**: Determine which aspect of the package you want to enhance. For example, you might want to add a new validated action or modify the policy validation logic.

2. **Modify the relevant file**:

   - To add a new validated action, start with [server.ts](./src/server.ts). Define the new action and ensure it is validated against the active plan and organizational policies.
   - If the new action requires additional policy checks, update the policy validation logic in the `validation` library.

3. **Update the CLI (if needed)**: If your changes require new command-line options, update [cli.ts](./src/cli.ts) to handle the new subcommands or arguments.

4. **Test your changes**:

   - Add unit tests in [mcpValidationTest.ts](./src/mcpValidationTest.ts) to verify that your changes work as expected.
   - Use the `validation` library to simulate various scenarios and ensure compliance with organizational policies.

5. **Run the tests**: Execute the tests to confirm that your changes do not introduce regressions or break existing functionality.

By following these steps, you can extend the `mcp-plan-validation` package to support additional features or adapt it to specific use cases.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-12T08:45:00.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter mcp-plan-validation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
