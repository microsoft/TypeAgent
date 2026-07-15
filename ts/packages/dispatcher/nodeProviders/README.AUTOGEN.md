<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9c810579ad4988de628f0a1930b74adb31224cff3d291c7530877c8d7768a1c5 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# dispatcher-node-providers — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `dispatcher-node-providers` package is a TypeScript library in the TypeAgent monorepo. It provides node-based implementations for dispatcher providers, enabling the creation, execution, and management of agents in various runtime environments. This package is a core component of the TypeAgent system, facilitating agent execution in both separate processes and dispatcher-managed processes.

## What it does

The package focuses on enabling flexible and efficient agent execution by providing the following key functionalities:

- **Agent Providers**: Implements mechanisms for creating and managing agents. For example, the `createNpmAppAgentProvider` function in [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts) supports NPM-based agents and handles execution modes (`separate` or `dispatcher`).
- **Agent Processes**: Manages the lifecycle of agent processes, including their creation, communication, and termination. This is handled in files like [agentProcess.ts](./src/agentProvider/process/agentProcess.ts) and [agentProcessShim.ts](./src/agentProvider/process/agentProcessShim.ts).
- **Storage Providers**: Includes a file system-based storage provider, implemented in [fsStorageProvider.ts](./src/storageProvider/fsStorageProvider.ts), which allows agents to securely read and write data to the file system.

These features make the package a critical part of the TypeAgent ecosystem, enabling agents to operate in diverse environments while maintaining a consistent interface for execution and storage.

## Setup

To use the `dispatcher-node-providers` package, you need to configure the following environment variable:

- `TYPEAGENT_EXECMODE`: Specifies the execution mode for agents. It can be set to either `separate` (for separate processes) or `dispatcher` (for dispatcher-managed processes). The appropriate value depends on the desired runtime environment for your agents.

For additional details on configuring this variable, refer to the hand-written README.

## Key Files

The `dispatcher-node-providers` package is organized into several key files and directories, each responsible for specific functionality:

### Core Files

- **[index.ts](./src/index.ts)**: The main entry point of the package. It exports key functions such as `createNpmAppAgentProvider` and `getFsStorageProvider`.

### Agent Providers

- **[npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts)**: Implements the `createNpmAppAgentProvider` function, which is responsible for creating NPM-based agents. This file also defines the `ExecutionMode` type and includes logic for patching paths in agent manifests.

### Agent Processes

- **[agentProcess.ts](./src/agentProvider/process/agentProcess.ts)**: Manages the lifecycle of agent processes, including setup, inter-process communication, and termination. It ensures that agent processes are properly initialized and can communicate with the parent process.
- **[agentProcessShim.ts](./src/agentProvider/process/agentProcessShim.ts)**: Provides a compatibility layer for creating and managing agent processes. It includes logic for determining the appropriate Node.js executable to use, particularly in environments like Electron.

### Storage Providers

- **[fsStorageProvider.ts](./src/storageProvider/fsStorageProvider.ts)**: Implements a file system-based storage provider. This allows agents to perform operations such as reading, writing, and listing files in a secure and structured manner.

## How to extend

To extend the functionality of the `dispatcher-node-providers` package, follow these steps:

1. **Understand the existing structure**: Familiarize yourself with the key files and their responsibilities. For example, review [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts) for agent provider logic or [agentProcess.ts](./src/agentProvider/process/agentProcess.ts) for process management.

2. **Identify the area to extend**: Determine whether you need to add a new agent provider, enhance process management, or implement a new storage provider.

3. **Add or modify files**:

   - To add a new agent provider, create a new file in the `agentProvider` directory and implement the necessary interfaces.
   - To extend process management, modify or add files in the `process` subdirectory under `agentProvider`.
   - To create a new storage provider, add a file in the `storageProvider` directory and implement the `StorageProvider` interface.

4. **Follow existing patterns**: Use the existing code as a guide for implementing new functionality. For example, ensure that new agent providers handle execution modes and path patching as seen in [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts).

5. **Test your changes**: Write comprehensive tests to validate your new functionality. Ensure that your tests cover various scenarios, including edge cases.

By following these steps, you can effectively extend the `dispatcher-node-providers` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)

External: `@azure/msal-node-extensions`, `debug`

### Used by

- [agent-api](../../../packages/api/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- [onboarding-agent](../../../packages/agents/onboarding/README.md)

### Files of interest

`./src/index.ts`, `./src/agentProvider/npmAgentProvider.ts`, `./src/agentProvider/process/agentProcess.ts`, …and 3 more under `./src/`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_EXECMODE`

---

_Auto-generated against commit `5c9fc637c2f0a96d75d41a3bc9054d06247d26d8` on `2026-07-15T08:50:41.068Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter dispatcher-node-providers docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
