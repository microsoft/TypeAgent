<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3432c19faeb32251b064c2d12595e95585c191107a3f11fd491a17e3a3c70302 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# dispatcher-node-providers — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `dispatcher-node-providers` package is a TypeScript library within the TypeAgent monorepo. It provides node implementations for various dispatcher providers, enabling the execution and management of agents in different environments.

## What it does

This package offers several key functionalities:

- **Agent Providers**: It includes implementations for creating and managing agents, such as the `createNpmAppAgentProvider` function found in [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts). These providers facilitate the execution of agents in different modes, such as separate processes or dispatcher processes.
- **Storage Providers**: The package includes a file system storage provider, `getFsStorageProvider`, which allows agents to read and write data to the file system securely.
- **Agent Processes**: It provides mechanisms for handling agent processes, including creating and managing child processes, as seen in [agentProcess.ts](./src/agentProvider/process/agentProcess.ts) and [agentProcessShim.ts](./src/agentProvider/process/agentProcessShim.ts).

## Setup

To set up the `dispatcher-node-providers` package, you need to configure the following environment variable:

- `TYPEAGENT_EXECMODE`: This variable determines the execution mode for the agents. It can be set to either `separate` or `dispatcher` depending on the desired execution environment.

For detailed setup instructions, including how to obtain and configure the environment variable, please refer to the hand-written README.

## Key Files
The package is structured into several key components:

- **Agent Providers**: Located in the `agentProvider` directory, these files handle the creation and management of agents. For example, [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts) includes functions for creating NPM-based agents.
- **Agent Processes**: The `process` subdirectory within `agentProvider` contains files like [agentProcess.ts](./src/agentProvider/process/agentProcess.ts) and [agentProcessShim.ts](./src/agentProvider/process/agentProcessShim.ts), which manage the lifecycle and communication of agent processes.
- **Storage Providers**: The [fsStorageProvider.ts](./src/storageProvider/fsStorageProvider.ts) file implements a file system-based storage provider, allowing agents to interact with the file system for data storage.

### Key Files and Their Responsibilities

- **[index.ts](./src/index.ts)**: This file serves as the entry point for the package, exporting key functionalities such as `createNpmAppAgentProvider` and `getFsStorageProvider`.
- **[npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts)**: Contains the implementation for creating NPM-based agents, including handling execution modes and patching paths in manifests.
- **[agentProcess.ts](./src/agentProvider/process/agentProcess.ts)**: Manages the lifecycle of agent processes, including setup, communication, and termination.
- **[agentProcessShim.ts](./src/agentProvider/process/agentProcessShim.ts)**: Provides a shim for creating and managing agent processes, ensuring compatibility with different environments.
- **[fsStorageProvider.ts](./src/storageProvider/fsStorageProvider.ts)**: Implements a file system-based storage provider, allowing agents to securely read and write data.

## How to extend

To extend the `dispatcher-node-providers` package, follow these steps:

1. **Identify the component to extend**: Determine whether you need to add functionality to agent providers, agent processes, or storage providers.
2. **Modify or add files**: Based on the component, modify existing files or add new ones. For example, to add a new agent provider, you might create a new file in the `agentProvider` directory.
3. **Implement the required functionality**: Follow the patterns established in the existing files. For instance, if adding a new agent provider, ensure it implements the necessary interfaces and handles agent creation and management.
4. **Test your changes**: Write tests to verify the new functionality. Ensure that the tests cover various scenarios and edge cases.

Start by exploring the existing files such as [npmAgentProvider.ts](./src/agentProvider/npmAgentProvider.ts) and [agentProcess.ts](./src/agentProvider/process/agentProcess.ts) to understand the current implementation patterns.

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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter dispatcher-node-providers docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
