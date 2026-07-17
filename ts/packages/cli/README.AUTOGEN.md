<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=75b48e1fccd009ff53911d9c183f77dcda4fc8edd927a160391593ce6cbf0947 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-cli — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-cli` package is a command-line interface (CLI) for interacting with the TypeAgent system. It provides a suite of tools for managing conversations, testing agent interactions, and executing commands against the TypeAgent Dispatcher. The CLI is designed to support both interactive and non-interactive workflows, making it a key utility for developers working with the TypeAgent framework.

## What it does

The `agent-cli` package offers several subcommands, each serving a specific purpose:

- **`connect`**: The default subcommand, used for real-time interaction with the TypeAgent Dispatcher. It allows users to send requests, receive responses, and manage conversations interactively. This mode is ideal for testing and debugging agent behavior.
- **`run`**: Executes dispatcher commands non-interactively. This includes sending requests, translating them, or generating explanations without requiring user confirmation. It is useful for scripting and automation.
- **`replay`**: Replays chat histories for regression testing or generating test files. This is particularly helpful for validating agent behavior over time or reproducing specific scenarios.
- **`conversations`**: Provides tools for managing conversations on the agent server. Subcommands include:
  - `create`: Create a new conversation.
  - `delete`: Delete an existing conversation.
  - `list`: List all conversations.
  - `rename`: Rename a conversation.
- **`data`**: Manages explanation test data. Subcommands include:
  - `add`: Add new data to the explanation test dataset.
  - `diff`: Compare differences between datasets.

These commands enable developers to interact with the TypeAgent system in various ways, from testing and debugging to managing agent conversations and datasets.

## Setup

To set up and use the `agent-cli` package, follow these steps:

1. **Build the workspace**:

   - Navigate to the workspace root (repo `ts` directory) and run `pnpm setup` to initialize the environment.
   - Build the project using the appropriate `pnpm` commands.

2. **Run the CLI**:

   - From the workspace root, use `pnpm run cli` or `pnpm run cli:dev` to start the CLI.
   - Alternatively, navigate to the `agent-cli` package directory and run the CLI directly:
     - On Linux: `./bin/run.js` (or `./bin/dev.js` for development).
     - On Windows: `.\bin\run` (or `.\bin\dev` for development).

3. **Optional global linking**:
   - Run `pnpm link --global` in the package directory to link the CLI globally.
   - Use `agent-cli` (or `agent-cli-dev` for the development version) to invoke the CLI globally.
   - To unlink, run `pnpm uninstall --global agent-cli`.

For additional details on setup and usage, refer to the hand-written README.

## Key Files

The `agent-cli` package is organized into several key files and directories, each responsible for specific functionalities:

- **`src/commands/`**: Contains the implementation of CLI subcommands.

  - **`connect.ts`**: Implements the `connect` subcommand for real-time interaction with the TypeAgent Dispatcher.
  - **`run/index.ts`**: Handles the `run` subcommand for executing dispatcher commands non-interactively.
  - **`replay.ts`**: Manages the `replay` subcommand for replaying chat histories.
  - **`conversations/`**: Includes commands for managing conversations:
    - `create.ts`: Create a new conversation.
    - `delete.ts`: Delete an existing conversation.
    - `list.ts`: List all conversations.
    - `rename.ts`: Rename a conversation.
  - **`data/`**: Contains commands for managing explanation test data:
    - `add.ts`: Add new data to the explanation test dataset.
    - `diff.ts`: Compare differences between datasets.

- **Dependencies**: The package relies on several internal dependencies from the TypeAgent monorepo, such as:
  - `@typeagent/action-schema`, `@typeagent/agent-sdk`, `@typeagent/agent-server-client`, and others for core functionality.
  - External libraries like `@oclif/core` for CLI scaffolding and `chalk` for terminal output formatting.

## How to extend

To extend the `agent-cli` package, follow these steps:

1. **Identify the command to extend or create**:

   - Explore the `src/commands/` directory to locate existing commands.
   - If creating a new command, decide on its purpose and structure.

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

By following these steps, you can extend the `agent-cli` package to support additional functionalities and improve its utility.

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

_Auto-generated against commit `35dcce8d8016eaa0731594b1cc83fb2b2d22302b` on `2026-07-17T16:28:11.775Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-cli docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
