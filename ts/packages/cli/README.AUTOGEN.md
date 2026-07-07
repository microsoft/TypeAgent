<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=379153755e64cc3874d3d2391debc2c5b4a3ec03c67b484349627b511e4b1ee5 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-cli — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-cli` package provides a command-line interface (CLI) for interacting with the TypeAgent system. It enables users to connect to the TypeAgent Dispatcher, send requests, and manage conversations with agents. The CLI supports various subcommands for different functionalities, including connecting to the dispatcher, running commands non-interactively, and replaying chat histories for testing purposes.

## What it does

The `agent-cli` package offers several subcommands to interact with the TypeAgent system. The primary subcommand is `connect`, which is the default when no subcommand is specified. This command allows users to interact with the TypeAgent Dispatcher in real-time, sending requests and receiving responses. Other subcommands include:

- **`run`**: Execute dispatcher commands non-interactively. This includes sending requests, translating them, or generating explanations.
- **`replay`**: Replay chat histories for regression testing or generating test files.
- **`conversations`**: Manage conversations on the agent server, including creating, deleting, listing, and renaming conversations.
- **`data`**: Manage explanation test data, such as adding new data or comparing differences between datasets.

These commands provide a comprehensive interface for interacting with the TypeAgent system, enabling users to perform actions, translate requests, and manage conversations effectively.

## Setup

To set up and use the `agent-cli` package, follow these steps:

1. **Build the workspace**: Ensure the workspace root (repo `ts` directory) is set up and built. Run `pnpm setup` to create the global bin for `pnpm` if not already done.
2. **Run the CLI**:
   - From the workspace root, use `pnpm run cli` or `pnpm run cli:dev` to start the CLI.
   - Alternatively, navigate to the `agent-cli` package directory and run the CLI directly:
     - On Linux: `./bin/run.js` (or `./bin/dev.js` for development).
     - On Windows: `.\bin\run` (or `.\bin\dev` for development).
3. **Optional global linking**:
   - Run `pnpm link --global` in the package directory to link the CLI globally.
   - Use `agent-cli` (or `agent-cli-dev` for the development version) to invoke the CLI globally.
   - To unlink, run `pnpm uninstall --global agent-cli`.

For more details on setup and usage, refer to the hand-written README.

## Key Files

The `agent-cli` package is organized into several key files and directories, each responsible for specific functionalities:

- **`src/commands/`**: Contains the implementation of CLI subcommands.

  - **`connect.ts`**: Implements the `connect` subcommand, which allows users to interact with the TypeAgent Dispatcher in real-time.
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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-cli docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
