<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=63237fcb74e9501fc3112ca39a46518e4e3bcf0c61828a7d8f5c097dc149bb81 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# mcp-plan-validation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `mcp-plan-validation` package is a TypeScript library designed to facilitate plan-validated agent execution via the Model Context Protocol (MCP). It ensures that agent actions comply with organizational policies by validating plans and enforcing self-checking model loops.

## What it does

This package provides a server that validates and executes plans submitted by agents. It supports various actions such as `get_plan_schema`, `submit_plan`, `plan_status`, `plan_reset`, `validated_read`, `validated_write`, `validated_edit`, `validated_glob`, `validated_grep`, and `validated_bash`. The server ensures that each action adheres to the current plan step and organizational policies before execution.

The package integrates with the `validation` library to load and enforce organizational policies. It uses the `@modelcontextprotocol/sdk` for server transport and communication, `fast-glob` for file operations, and `zod` for schema validation.

## Setup

To set up the `mcp-plan-validation` package, you need to install the necessary dependencies and configure the MCP server. The package requires the following environment variables:

- `MCP_SERVER_COMMAND`: Command to start the MCP server.
- `MCP_SERVER_ARGS`: Arguments for the MCP server command.
- `ORG_POLICY_PATH`: Path to the organizational policy JSON file.

You can obtain these values by following the instructions in the hand-written README. Additionally, you may need to configure client-specific settings for tools like Claude, Copilot, or Cursor.

## Key Files
The package is structured into several key files, each responsible for different aspects of the plan validation and execution process:

- [index.ts](./src/index.ts): Entry point for the MCP server, handling policy loading and server initialization.
- [cli.ts](./src/cli.ts): Command-line interface for initializing and serving the MCP server.
- [executor.ts](./src/executor.ts): Implements file and shell operations for validated proxy tools.
- [init.ts](./src/init.ts): Scaffolds plan validation into an existing project, creating necessary policy and settings files.
- [mcpValidationTest.ts](./src/mcpValidationTest.ts): Tests the MCP server's validation and enforcement capabilities.
- [planState.ts](./src/planState.ts): Manages the state of plan execution, including steps, bindings, and trace.
- [server.ts](./src/server.ts): MCP server implementation, exposing validated proxy tools and handling plan validation.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: This file serves as the main entry point for the MCP server. It initializes the server, loads the organizational policy, and sets up the transport mechanism for communication.
- **[cli.ts](./src/cli.ts)**: Provides a command-line interface for various operations such as initializing the server and serving the MCP server. It handles subcommands and routes them to the appropriate modules.
- **[executor.ts](./src/executor.ts)**: Contains the actual implementations for file and shell operations that are validated against the current plan and organizational policies. Functions like `executeRead` and `executeWrite` are defined here.
- **[init.ts](./src/init.ts)**: This file is responsible for scaffolding the plan validation setup into an existing project. It creates necessary policy files and client-specific settings.
- **[mcpValidationTest.ts](./src/mcpValidationTest.ts)**: Implements tests to verify that the MCP server correctly validates and enforces policies. It uses the Agent SDK to drive tests and observe enforcement.
- **[planState.ts](./src/planState.ts)**: Manages the state of plan execution, including tracking current steps, bindings, and execution trace. Functions like `createPlanState` and `resetState` are defined here.
- **[server.ts](./src/server.ts)**: Implements the MCP server, exposing various validated proxy tools and handling plan validation. It defines the flow for plan submission, validation, and execution.

## How to extend

To extend the `mcp-plan-validation` package, follow these steps:

1. **Open the relevant file**: Depending on the functionality you want to extend, open the corresponding file. For example, if you want to add a new validated tool, start with [server.ts](./src/server.ts).

2. **Add new actions**: Define new actions in the server implementation. Ensure that each action is validated against the current plan step and organizational policies.

3. **Update policy validation**: If your new actions require additional policy checks, update the policy validation logic in the `validation` library.

4. **Test your changes**: Add tests in [mcpValidationTest.ts](./src/mcpValidationTest.ts) to verify that your new actions are correctly validated and enforced.

5. **Run tests**: Execute the tests to ensure that your changes do not break existing functionality.

By following these steps, you can extend the package to support additional validated actions and enhance its capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- validation

External: `@modelcontextprotocol/sdk`, `fast-glob`, `zod`

### Used by

- [plan-validation-demo](../../../examples/planValidationDemo/README.md)

### Files of interest

`./src/index.ts`, `./src/cli.ts`, `./src/executor.ts`, …and 4 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:26.515Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter mcp-plan-validation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
