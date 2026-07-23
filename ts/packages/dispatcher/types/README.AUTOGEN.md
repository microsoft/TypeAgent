<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=0bf32cbdb49e9336393bacb2cb2cb723d41c23bfdaf9e2842854efc73545a683 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/dispatcher-types — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/dispatcher-types` package provides a comprehensive set of TypeScript type definitions that are foundational to the TypeAgent ecosystem. These types are used to define the structure of data exchanged between the dispatcher, agents, and clients, ensuring type safety and consistency across the system. This package is a core dependency for many other packages in the TypeAgent monorepo, including `@typeagent/agent-server-protocol`, `@typeagent/copilot-plugin`, and `agent-dispatcher`.

## What it does

This package defines a wide range of types and utilities that support the functionality of the TypeAgent dispatcher and its interactions with other components. Key areas of functionality include:

- **Dispatcher Communication**: Types such as `RequestId`, `DispatcherName`, and `DispatcherEmoji` define the identity and communication structure of the dispatcher.
- **Client Input/Output**: Types like `IAgentMessage`, `TemplateEditConfig`, and `NotifyExplainedData` facilitate client interactions, including message formatting, template management, and data exchange.
- **Pending Interactions**: Types such as `PendingInteractionRequest` and `PendingInteractionResponse` define the structure of interactions that require client input, such as questions, proposed actions, or forms.
- **Queue Management**: Types like `QueuedRequest`, `QueueCancelReason`, and `QueueRequestState` define the lifecycle and management of server-side message queues.
- **Logging and Display**: Types such as `SetDisplayEntry` and `AppendDisplayEntry` are used for managing and formatting log entries for display purposes.
- **Dispatcher Status**: Helper functions like `getStatusSummary` in [status.ts](./src/helpers/status.ts) provide utilities for summarizing and representing the state of the dispatcher.

These types are consumed by various packages in the TypeAgent ecosystem, enabling consistent and reliable communication between components.

## Setup

This package does not require any special setup beyond installation. To include it in your project, run:

```bash
pnpm install
```

For additional details, refer to the hand-written README.

## Key Files

The `@typeagent/dispatcher-types` package is organized into several key files, each focusing on a specific aspect of the dispatcher:

- [src/index.ts](./src/index.ts): The main entry point for the package, exporting all the types and utilities defined in other modules.
- [src/clientIO.ts](./src/clientIO.ts): Contains types related to client input/output operations, such as `IAgentMessage`, `TemplateEditConfig`, and `NotifyExplainedData`.
- [src/dispatcher.ts](./src/dispatcher.ts): Defines core dispatcher types, including `RequestId`, `DispatcherName`, and `DispatcherEmoji`.
- [src/displayLogEntry.ts](./src/displayLogEntry.ts): Provides types for logging and displaying information, such as `SetDisplayEntry` and `AppendDisplayEntry`.
- [src/pendingInteraction.ts](./src/pendingInteraction.ts): Manages types for pending interactions, including `PendingInteractionRequest` and `PendingInteractionResponse`.
- [src/helpers/status.ts](./src/helpers/status.ts): Implements helper functions for summarizing dispatcher statuses, such as `getStatusSummary`.
- [src/queue.ts](./src/queue.ts): Defines types for the server-side message queue, including `QueuedRequest`, `QueueCancelReason`, and `QueueRequestState`.
- [src/queueStateMirror.ts](./src/queueStateMirror.ts): Implements the client-side mirror of the server's per-conversation queue.
- [src/awaitCommand.ts](./src/awaitCommand.ts): Provides a utility function `awaitCommand` for submitting commands to the dispatcher and awaiting their completion.

## How to extend

To extend the `@typeagent/dispatcher-types` package, follow these steps:

1. **Identify the type to extend**: Determine which type or module you need to modify or extend. For example, if you need to add a new type for client interactions, start with [clientIO.ts](./src/clientIO.ts).

2. **Modify or add new types**: Open the relevant file and add your new type definitions or modify existing ones. Ensure that your changes align with the existing structure and naming conventions.

3. **Export new types**: If you add new types, ensure they are exported in [index.ts](./src/index.ts) so they can be accessed by other packages.

4. **Write tests**: Create or update test cases to validate your changes. This ensures that your modifications work as intended and do not introduce regressions.

5. **Run tests**: Use the command `pnpm test` to execute the test suite and verify the correctness of your changes.

By following these steps, you can effectively contribute to the `@typeagent/dispatcher-types` package and ensure its continued utility and reliability within the TypeAgent monorepo.

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
- [@typeagent/browser-extension](../../../packages/agents/browserExtension/README.md)
- [@typeagent/copilot-plugin](../../../packages/copilot-plugin/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [chat-ui](../../../packages/chat-ui/README.md)
- _…and 8 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/awaitCommand.ts`, `./src/clientIO.ts`, …and 7 more under `./src/`.

---

_Auto-generated against commit `8f591da77983db53fd4a3e0ca12b58d80aaa3628` on `2026-07-22T20:55:48.144Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/dispatcher-types docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
