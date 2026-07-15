<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=dc46815195a0847d417c9138be18f82ced8524cfdb8d2666c95f57fccb854cf4 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-cli — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-cli` package is a command-line interface (CLI) for interacting with the TypeAgent system. It serves as a front-end to the TypeAgent Dispatcher, enabling users to send requests, manage conversations, and perform various operations with agents. The CLI supports multiple subcommands, including interactive and non-interactive modes, as well as tools for testing and managing data.

## What it does

The `agent-cli` package provides several subcommands to interact with the TypeAgent system:

- **`connect`**: The default subcommand, used for real-time interaction with the TypeAgent Dispatcher. Users can send requests, receive responses, and manage conversations interactively.
- **`run`**: Executes dispatcher commands non-interactively. This includes:
  - `request`: Sends a request to the dispatcher without confirmation.
  - `translate`: Translates a user request into an action.
  - `explain`: Generates an explanation for a specific request-to-action mapping.
- **`replay`**: Replays chat histories for regression testing or generating test files. Supports options for translation-only mode and test file generation.
- **`conversations`**: Manages conversations on the agent server. Subcommands include:
  - `create`: Creates a new conversation.
  - `delete`: Deletes an existing conversation.
  - `list`: Lists all conversations.
  - `rename`: Renames a conversation.
- **`data`**: Manages explanation test data. Subcommands include:
  - `add`: Adds new data to the explanation test dataset.
  - `diff`: Compares differences between datasets.

These commands provide a comprehensive interface for interacting with the TypeAgent system, enabling users to perform actions, manage conversations, and test functionalities effectively.

## Setup

To set up and use the `agent-cli` package, follow these steps:

1. **Build the workspace**:

   - Navigate to the workspace root (repo `ts` directory) and run `pnpm setup` to initialize the environment.
   - Build the project using the appropriate commands in the workspace root.

2. **Run the CLI**:

   - From the workspace root, use `pnpm run cli` or `pnpm run cli:dev` to start the CLI.
   - Alternatively, navigate to the `agent-cli` package directory and run the CLI directly:
     - On Linux: `./bin/run.js` (or `./bin/dev.js` for development).
     - On Windows: `.\bin\run` (or `.\bin\dev` for development).

3. **Optional global linking**:
   - Run `pnpm link --global` in the package directory to link the CLI globally.
   - Use `agent-cli` (or `agent-cli-dev` for the development version) to invoke the CLI globally.
   - To unlink, run `pnpm uninstall --global agent-cli`.

For additional details, refer to the hand-written README.

## Key Files

The `agent-cli` package is organized into several key files and directories:

- **`src/commands/`**: Contains the implementation of all CLI subcommands.

  - **`connect.ts`**: Implements the `connect` subcommand for real-time interaction with the TypeAgent Dispatcher.
  - **`run/index.ts`**: Handles the `run` subcommand for non-interactive dispatcher commands.
  - **`replay.ts`**: Implements the `replay` subcommand for replaying chat histories.
  - **`conversations/`**: Contains commands for managing conversations:
    - `create.ts`: Create a new conversation.
    - `delete.ts`: Delete an existing conversation.
    - `list.ts`: List all conversations.
    - `rename.ts`: Rename a conversation.
  - **`data/`**: Contains commands for managing explanation test data:
    - `add.ts`: Add new data to the explanation test dataset.
    - `diff.ts`: Compare differences between datasets.

- **Dependencies**:
  - Internal dependencies include `@typeagent/action-schema`, `@typeagent/agent-sdk`, `@typeagent/agent-server-client`, and others for core functionality.
  - External dependencies include `@oclif/core` for CLI scaffolding, `chalk` for terminal output formatting, and `dotenv` for environment variable management.

## How to extend

To extend the `agent-cli` package, follow these steps:

1. **Identify the command to extend or create**:

   - Explore the `src/commands/` directory to locate existing commands.
   - If creating a new command, determine its purpose and structure.

2. **Create a new command**:

   - Add a new TypeScript file in the appropriate subdirectory under `src/commands/`.
   - Implement the command by extending the `Command` class from `@oclif/core`.
   - Define arguments, flags, and the command's logic.

3. **Integrate with the TypeAgent system**:

   - Use the provided SDKs and clients (e.g., `@typeagent/agent-server-client`) to interact with the dispatcher or agent server.
   - Follow patterns from existing commands like `connect.ts` or `run/index.ts`.

4. **Test your command**:

   - Add unit tests to verify the command's functionality.
   - Use the `replay` subcommand to generate test files for regression testing.

5. **Update documentation**:
   - Document the new command in the hand-written README, including usage examples and available flags.

For example, to add a command for exporting conversation logs, you might create a file `src/commands/conversations/export.ts` and implement logic to fetch and save logs from the agent server.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [interactive-app](../../packages/interactiveApp/README.md)
- [telemetry](../../packages/telemetry/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)

External: `@oclif/core`, `@oclif/plugin-help`, `chalk`, `debug`, `dotenv`, `html-to-text`, `marked`, `marked-terminal`, `open`, `ts-node`

### Files of interest

`./src/commands/run/index.ts`, `./src/index.ts`, `./src/commands/connect.ts`, …and 28 more under `./src/`.

---

_Auto-generated against commit `f928ce70269b7d0f8942977c29147b2c8832b722` on `2026-07-15T22:42:29.947Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-cli docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
