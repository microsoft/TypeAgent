<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b603cf92cecb6dc379f818c4d3e49274945d53dd353ecee84efc524d292e3763 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/dispatcher-types — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/dispatcher-types` package provides a centralized collection of TypeScript type definitions for the TypeAgent dispatcher. These types are essential for ensuring consistent and type-safe communication between various components of the TypeAgent ecosystem, such as agents, clients, and dispatchers. By standardizing the data structures and interfaces, this package helps maintain compatibility and reliability across the system.

## What it does

This package defines and exports TypeScript types that are used throughout the TypeAgent dispatcher and its related components. These types are consumed by multiple packages in the TypeAgent monorepo, including `@typeagent/agent-server-protocol`, `@typeagent/copilot-plugin`, and `agent-dispatcher`. The key functionalities provided by this package include:

- **Dispatcher Requests and Responses**: Types such as `RequestId`, `PendingInteractionRequest`, and `PendingInteractionResponse` define the structure of requests and responses handled by the dispatcher.
- **Client Input/Output Operations**: Types like `IAgentMessage`, `TemplateEditConfig`, and `NotifyExplainedData` are used to manage client interactions, including message formatting and data exchange.
- **Dispatcher Status Management**: The package includes types and helper functions (e.g., `getStatusSummary` in [status.ts](./src/helpers/status.ts)) to represent and summarize the state of the dispatcher.
- **Queue Management**: Types such as `QueuedRequest`, `QueueCancelReason`, and `QueueRequestState` define the structure and lifecycle of server-side message queues.
- **Logging and Display**: Types like `SetDisplayEntry` and `AppendDisplayEntry` in [displayLogEntry.ts](./src/displayLogEntry.ts) are used for managing and formatting log entries for display purposes.

These types are foundational for the operation of the TypeAgent dispatcher and its integration with other components in the system.

## Setup

This package does not require any special setup beyond installation. To include it in your project, simply run:

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
- [@typeagent/copilot-plugin](../../../packages/copilot-plugin/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [chat-ui](../../../packages/chat-ui/README.md)
- [coder-wrapper](../../../packages/coderWrapper/README.md)
- _…and 6 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/awaitCommand.ts`, `./src/clientIO.ts`, …and 7 more under `./src/`.

---

_Auto-generated against commit `defc71271dc68db47e0d376be7aa9f755da0ac91` on `2026-07-14T08:47:00.044Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/dispatcher-types docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
