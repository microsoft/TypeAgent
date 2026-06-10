<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=cd656f1f0132dfd01cfe55093c1cd68c1ec9f0ae9f92fee18c049ac58f77be4d -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-cli — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-cli` package provides a command-line interface (CLI) for interacting with the TypeAgent system. It allows users to connect to the TypeAgent Dispatcher, send requests, and manage conversations with agents. The CLI supports various subcommands for different functionalities, including connecting to the dispatcher, running commands non-interactively, and replaying chat histories for testing purposes.

## What it does

The `agent-cli` package hosts multiple subcommands, with the primary one being `connect`, which is the default when no subcommand is specified. The `connect` subcommand allows users to interact with the TypeAgent Dispatcher, sending requests and receiving responses in real-time. Other subcommands include:

- `run`: Execute dispatcher commands non-interactively.
- `replay`: Replay chat histories for regression testing.
- `conversations`: Manage conversations on the agent server (create, delete, list, rename).
- `data`: Manage explanation test data (add, diff).

These commands facilitate various interactions with the TypeAgent system, enabling users to perform actions, translate requests, and manage conversations efficiently.

## Setup

To set up the `agent-cli` package, follow these steps:

1. Ensure the workspace root (repo `ts` directory) is set up and built.
2. Run `pnpm run cli` or `pnpm run cli:dev` in the workspace root to start the CLI.
3. Optionally, link the package globally by running `pnpm link --global` in the package directory. Use `agent-cli` or `agent-cli-dev` for the development version.
4. Alternatively, run the CLI directly using `./bin/run.js` (Linux) or `.\bin\run` (Windows). For development, use `./bin/dev.js` (Linux) or `.\bin\dev` (Windows).

Make sure `pnpm setup` has been run to create the global bin for pnpm, and the project is built. For detailed setup instructions, see the hand-written README.

## Key Files

The `agent-cli` package is structured around several key files and directories:

- `src/commands/`: Contains the implementation of various CLI commands.
  - `connect.ts`: Handles the `connect` subcommand, allowing users to interact with the TypeAgent Dispatcher.
  - `run/index.ts`: Implements the `run` subcommand for executing dispatcher commands non-interactively.
  - `replay.ts`: Manages the `replay` subcommand for replaying chat histories.
  - `conversations/`: Contains commands for managing conversations (`create.ts`, `delete.ts`, `list.ts`, `rename.ts`).
  - `data/`: Includes commands for managing explanation test data (`add.ts`, `diff.ts`).

The package relies on several dependencies from the TypeAgent monorepo, including `@typeagent/action-schema`, `@typeagent/agent-sdk`, `@typeagent/agent-server-client`, and others. These dependencies provide the necessary functionality for interacting with the TypeAgent system.

## How to extend

To extend the `agent-cli` package, follow these steps:

1. Identify the command you want to extend or create a new command. Start by exploring the `src/commands/` directory.
2. Create a new TypeScript file for your command in the appropriate subdirectory (e.g., `src/commands/yourCommand.ts`).
3. Implement the command by extending the `Command` class from `@oclif/core` and defining the necessary arguments, flags, and logic.
4. Ensure your command interacts with the TypeAgent system using the provided SDKs and clients.
5. Add tests for your command to verify its functionality. You can use the `replay` subcommand to generate test files for regression testing.
6. Update the documentation in the hand-written README to include your new command and its usage.

For example, to add a new command for listing agent statuses, you might create a file `src/commands/status/list.ts` and implement the logic to fetch and display agent statuses from the dispatcher.

By following these steps, you can extend the `agent-cli` package to support additional functionalities and improve its capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- [action-grammar](../../packages/actionGrammar/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [aiclient](../../packages/aiclient/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [interactive-app](../../packages/interactiveApp/README.md)
- [telemetry](../../packages/telemetry/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)

External: `@oclif/core`, `@oclif/plugin-help`, `chalk`, `debug`, `dotenv`, `html-to-text`, `marked`, `marked-terminal`, `open`, `ts-node`

### Files of interest

`./src/commands/run/index.ts`, `./src/index.ts`, `./src/commands/connect.ts`, …and 28 more under `./src/`.

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.349Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-cli docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
