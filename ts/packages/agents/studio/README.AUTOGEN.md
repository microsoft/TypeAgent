<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f2f6d9d96956cccfa073fbc1cbda8f9b93814ba2b4d09d2002c0427285030c84 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# studio-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `studio-agent` package is a TypeAgent application agent that serves as the conversational interface for the TypeAgent Studio runtime. It provides developers with tools to inspect, monitor, and debug the Studio environment. By exposing read-only actions, the agent allows users to query the state of the Studio environment, identify schema collisions, and review recent events. This agent is a key component of the TypeAgent ecosystem, supporting the development and validation of other agents.

## What it does

The `studio-agent` package implements three read-only actions that provide insights into the TypeAgent Studio environment:

- **`getStudioInfo`**: This action reports the Studio's environment, including the repository root and the directories it scans for agent packages. It also provides the count of agent packages in each directory. This is useful for verifying that Studio is configured correctly and scanning the intended locations.

- **`listCollisions`**: This action lists cross-schema grammar collisions detected by Studio, ordered from newest to oldest. These collisions are identified during grammar scans and are essential for debugging and resolving conflicts between agent schemas.

- **`queryEvents`**: This action retrieves the most recent entries from Studio's structured event stream, which includes sandbox, collision, replay, and feedback events. The results are presented in chronological order, and the number of events returned can be limited using an optional `limit` parameter.

These actions are designed to provide developers with a clear understanding of the Studio environment's current state, help identify potential issues, and monitor recent activities.

## Setup

To use the `studio-agent` package, you need to configure the following environment variable:

- **`STUDIO_REGISTRY_PORT`**: This variable specifies the port on which the Studio registry server will run. It is required for the agent to communicate with the Studio service. If additional details on how to set this variable are provided in the hand-written README, refer to that document for guidance.

Ensure that the environment variable is set in your shell or in the `ts/.env` file before running the agent.

## Key Files

The `studio-agent` package is organized into several key files, each with a specific role in the agent's functionality:

- **[studioActionHandler.ts](./src/studioActionHandler.ts)**: This file contains the main logic for the agent, including the `executeAction` function that processes the supported actions. It also manages the initialization, updating, and closing of the agent context.

- **[studioManifest.json](./src/studioManifest.json)**: This file defines the agent's metadata, such as its description, emoji representation, and the schema file that specifies the supported actions.

- **[studioSchema.ts](./src/studioSchema.ts)**: This file contains the type definitions for the actions supported by the agent. It defines the structure and parameters for actions like `getStudioInfo`, `listCollisions`, and `queryEvents`.

- **[inspect.ts](./src/lib/inspect.ts)**: This file provides pure Markdown formatters for the agent's read-only inspection results. These formatters are designed to be unit-testable and are used to generate human-readable output for the actions.

- **[studioServiceLifecycle.ts](./src/lib/studioServiceLifecycle.ts)**: This file manages the lifecycle of the Studio service, including the registry server and session context. It ensures that the agent can discover and communicate with the Studio service.

## How to extend

To extend the `studio-agent` package with new functionality, follow these steps:

1. **Define new actions in `studioSchema.ts`**:

   - Add a new action type to the `StudioActions` union type.
   - Ensure the new action has a unique `actionName` and define its parameters.

2. **Implement the action in `studioActionHandler.ts`**:

   - Extend the `executeAction` function to handle the new action.
   - Use helper functions and formatters as needed to process the action and generate the desired output.

3. **Update the manifest in `studioManifest.json`**:

   - Add the new action to the schema details in the manifest file.
   - Ensure the manifest accurately reflects the updated capabilities of the agent.

4. **Write unit tests**:

   - Create tests for the new action and any associated helper functions or formatters.
   - Place the tests in an appropriate directory, such as `./tests/`.

5. **Test the integration**:
   - Run the agent in the TypeAgent Studio environment to verify that the new action works as expected.
   - Check the output of the action to ensure it meets the requirements.

By following these steps, you can extend the `studio-agent` package to support additional actions and enhance its utility within the TypeAgent Studio ecosystem.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/studioManifest.json](./src/studioManifest.json)
- `./agent/handlers` → `./dist/studioActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/core](../../../packages/typeagent-core/README.md)
- [@typeagent/websocket-utils](../../../packages/utils/webSocketUtils/README.md)
- [studio-service](../../../packages/studio-service/README.md)

External: `debug`, `ws`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/studioActionHandler.ts`, `./src/studioManifest.json`, `./src/studioSchema.ts`, …and 4 more under `./src/`.

### Agent surface

- Manifest: [./src/studioManifest.json](./src/studioManifest.json)
- Schema: [./src/studioSchema.ts](./src/studioSchema.ts)
- Handler: [./src/studioActionHandler.ts](./src/studioActionHandler.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `STUDIO_REGISTRY_PORT`

### Actions

_3 actions implemented by this agent, parsed deterministically from `./src/studioSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                                                                                                                                                   | Action           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| _Report Studio's environment: the repository root it is inspecting and the directories ("agent locations") it scans for agents, with how many agent packages each contains_ | `getStudioInfo`  |
| _List the cross-schema grammar collisions Studio currently knows about (newest first)_                                                                                      | `listCollisions` |
| _Show the most recent entries from Studio's structured event stream (sandbox/collision/replay/feedback events), oldest-to-newest_                                           | `queryEvents`    |

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter studio-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
