<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=58c4798e577149c4e972b153e286438936df079bf93a09f2447bd4b93fde47f4 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# dispatcher-node-providers — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `dispatcher-node-providers` package is a TypeScript library within the TypeAgent monorepo. It provides node-based implementations for dispatcher providers, which are essential for managing the lifecycle and execution of agents in various runtime environments. This package is a foundational component of the TypeAgent system, enabling agents to operate in isolated processes or within dispatcher-managed processes.

## What it does

The `dispatcher-node-providers` package offers several key functionalities to support the execution and management of agents:

- **Agent Providers**: The package includes implementations for creating and managing agents. For instance, the `createNpmAppAgentProvider` function in [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts) facilitates the creation of NPM-based agents. It also supports different execution modes, such as `separate` (agents run in isolated processes) and `dispatcher` (agents run in dispatcher-managed processes).

- **Agent Process Management**: The package provides tools for managing the lifecycle of agent processes, including their creation, communication, and termination. This functionality is implemented in files like [agentProcess.ts](./src/agentProvider/process/agentProcess.ts) and [agentProcessShim.ts](./src/agentProvider/process/agentProcessShim.ts). These files handle inter-process communication, process initialization, and compatibility with environments like Electron.

- **Storage Providers**: The package includes a file system-based storage provider, implemented in [fsStorageProvider.ts](./src/storageProvider/fsStorageProvider.ts). This allows agents to securely read, write, and manage data on the file system.

These features enable the package to serve as a critical building block for the TypeAgent ecosystem, ensuring that agents can operate in diverse environments while maintaining a consistent and reliable interface for execution and data storage.

## Setup

To use the `dispatcher-node-providers` package, you need to configure the following environment variable:

- `TYPEAGENT_EXECMODE`: This variable determines the execution mode for agents. It can be set to:
  - `separate`: Agents run in isolated processes.
  - `dispatcher`: Agents run in dispatcher-managed processes.

The appropriate value for `TYPEAGENT_EXECMODE` depends on the specific runtime environment and use case for your agents. Refer to the hand-written README for additional guidance on configuring this variable.

## Key Files

The `dispatcher-node-providers` package is organized into several key files and directories, each responsible for specific functionality:

### Core Files

- **[index.ts](./src/index.ts)**: The main entry point of the package. It exports key functions such as `createNpmAppAgentProvider` and `getFsStorageProvider`.

### Agent Providers

- **[npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts)**: This file implements the `createNpmAppAgentProvider` function, which is responsible for creating and managing NPM-based agents. It also defines the `ExecutionMode` type and includes logic for patching paths in agent manifests to ensure proper file resolution.

### Agent Processes

- **[agentProcess.ts](./src/agentProvider/process/agentProcess.ts)**: This file manages the lifecycle of agent processes, including their initialization, inter-process communication, and termination. It ensures that agent processes are properly set up and can communicate with the parent process.
- **[agentProcessShim.ts](./src/agentProvider/process/agentProcessShim.ts)**: This file provides a compatibility layer for creating and managing agent processes. It includes logic for determining the appropriate Node.js executable to use, particularly in environments like Electron, where the default Node.js executable may not be suitable.

### Storage Providers

- **[fsStorageProvider.ts](./src/storageProvider/fsStorageProvider.ts)**: This file implements a file system-based storage provider. It allows agents to perform operations such as reading, writing, and listing files in a secure and structured manner. The `getFsStorageProvider` function is the main export of this file.

## How to extend

To extend the `dispatcher-node-providers` package, follow these steps:

1. **Understand the existing structure**: Review the key files and their responsibilities. For example, examine [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts) for agent provider logic or [agentProcess.ts](./src/agentProvider/process/agentProcess.ts) for process management.

2. **Identify the area to extend**: Determine whether you need to add a new agent provider, enhance process management, or implement a new storage provider.

3. **Add or modify files**:

   - To add a new agent provider, create a new file in the `agentProvider` directory and implement the necessary interfaces. Use [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts) as a reference for structure and best practices.
   - To extend process management, modify or add files in the `process` subdirectory under `agentProvider`. For example, you might extend [agentProcess.ts](./src/agentProvider/process/agentProcess.ts) or [agentProcessShim.ts](./src/agentProvider/process/agentProcessShim.ts) to support additional process management features.
   - To create a new storage provider, add a file in the `storageProvider` directory and implement the `StorageProvider` interface. Use [fsStorageProvider.ts](./src/storageProvider/fsStorageProvider.ts) as a guide.

4. **Follow existing patterns**: Ensure that your implementation aligns with the patterns and conventions used in the existing codebase. For example, handle execution modes and path patching consistently with the approach in [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts).

5. **Test your changes**: Write comprehensive tests to validate your new functionality. Ensure that your tests cover various scenarios, including edge cases, to maintain the reliability of the package.

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

_Auto-generated against commit `d9ee555d43867e97462e8fa147f7ef73b8da05ec` on `2026-07-19T20:27:13.071Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter dispatcher-node-providers docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
