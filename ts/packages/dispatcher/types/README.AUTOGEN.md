<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f1c9d73ec38b94c2e2263558797db9f34f2b72495a7e6dd8e4195f4e99c7debe -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/dispatcher-types — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/dispatcher-types` package defines TypeScript types used by the TypeAgent dispatcher. These types are essential for ensuring consistent communication and data handling across various components of the TypeAgent system.

## What it does

This package provides a collection of TypeScript types that are used by the dispatcher to manage interactions, messages, and statuses. The types defined here are utilized by other packages within the TypeAgent monorepo, such as `@typeagent/agent-server-protocol`, `@typeagent/copilot-plugin`, and `agent-dispatcher`. Key functionalities include:

- Defining the structure of dispatcher requests and responses.
- Managing client interactions and messages.
- Handling dispatcher statuses and summaries.

## Setup

No additional setup is required beyond installing the package. Simply run `pnpm install` to include this package in your workspace. For detailed setup instructions, see the hand-written README.

## Key Files

The package is structured into several key files, each responsible for different aspects of the dispatcher types:

- [src/index.ts](./src/index.ts): The main entry point that exports types from other modules.
- [src/clientIO.ts](./src/clientIO.ts): Defines types related to client input/output operations, such as `IAgentMessage` and `TemplateEditConfig`.
- [src/dispatcher.ts](./src/dispatcher.ts): Contains core dispatcher types like `RequestId` and constants such as `DispatcherName` and `DispatcherEmoji`.
- [src/displayLogEntry.ts](./src/displayLogEntry.ts): Defines types for logging display entries, including `SetDisplayEntry` and `AppendDisplayEntry`.
- [src/pendingInteraction.ts](./src/pendingInteraction.ts): Manages types for pending interactions, such as `PendingInteractionRequest` and `PendingInteractionResponse`.
- [src/helpers/status.ts](./src/helpers/status.ts): Provides helper functions for summarizing dispatcher statuses.

## How to extend

To extend the `@typeagent/dispatcher-types` package, follow these steps:

1. **Identify the type to extend**: Determine which type or module needs modification or extension. For example, if you need to add a new type related to client interactions, you would start with [clientIO.ts](./src/clientIO.ts).

2. **Modify or add new types**: Open the relevant file and add your new type definitions or modify existing ones. Ensure that your changes are consistent with the existing structure and naming conventions.

3. **Export new types**: If you add new types, make sure they are exported in [index.ts](./src/index.ts) to be accessible from other packages.

4. **Test your changes**: Write tests to validate your new types and ensure they integrate correctly with the rest of the system. You can add tests in a new file or an existing test suite.

5. **Run the tests**: Execute the test suite to verify that your changes do not break existing functionality. Use the command `pnpm test` to run the tests.

By following these steps, you can effectively extend the functionality of the `@typeagent/dispatcher-types` package and contribute to the TypeAgent monorepo.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./helpers/status` → [./dist/helpers/status.js](./dist/helpers/status.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [@typeagent/agent-server-protocol](../../../packages/agentServer/protocol/README.md)
- [@typeagent/copilot-plugin](../../../packages/copilot-plugin/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [chat-ui](../../../packages/chat-ui/README.md)
- [coder-wrapper](../../../packages/coderWrapper/README.md)
- [command-executor-mcp](../../../packages/commandExecutor/README.md)
- [dispatcher-node-providers](../../../packages/dispatcher/nodeProviders/README.md)
- _…and 2 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/clientIO.ts`, `./src/dispatcher.ts`, …and 4 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/dispatcher-types docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
