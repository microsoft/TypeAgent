<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f2f6d9d96956cccfa073fbc1cbda8f9b93814ba2b4d09d2002c0427285030c84 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# studio-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `studio-agent` package is a TypeAgent application agent that acts as the conversational interface for the TypeAgent Studio runtime. It enables users to inspect, validate, and manage the Studio environment, which is used for developing, testing, and refining TypeAgent agents. This agent currently supports actions for retrieving Studio environment details, listing grammar collisions, and querying recent events.

## What it does

The `studio-agent` provides three key actions, all of which are read-only and designed to help users understand the state of the Studio environment:

- **`getStudioInfo`**: This action reports the Studio environment's configuration, including the repository root being inspected and the directories scanned for agents. It also provides a count of agent packages in each directory. This is particularly useful for verifying that Studio is correctly configured and pointing to the intended workspace.

- **`listCollisions`**: This action lists any cross-schema grammar collisions detected by Studio, ordered from the most recent to the oldest. These collisions are identified during schema validation scans and are essential for debugging and refining agent grammars. The list will be empty until a collision scan has been performed.

- **`queryEvents`**: This action retrieves the most recent entries from Studio's structured event stream, which includes sandbox, collision, replay, and feedback events. The results are displayed in chronological order, and the number of events returned can be limited using an optional parameter.

These actions are designed to provide insight into the Studio environment's current state, helping developers ensure their agents are functioning as expected.

## Setup

To use the `studio-agent` package, you need to configure the following environment variable:

- **`STUDIO_REGISTRY_PORT`**: Specifies the port on which the Studio registry server will run. This is required for the agent to communicate with the Studio service. If the hand-written README provides additional instructions for setting this variable, refer to it for guidance.

Ensure that the environment variable is set in your development environment before running the agent. If you are using a `.env` file, add the variable there.

## Key Files

The `studio-agent` package is structured around several key files that define its functionality:

- **[studioActionHandler.ts](./src/studioActionHandler.ts)**: This file contains the core logic for handling actions. It defines the `executeAction` function, which processes incoming actions and generates appropriate responses. It also manages the initialization, updating, and closing of the agent's context.

- **[studioManifest.json](./src/studioManifest.json)**: This file serves as the agent's manifest, describing its purpose, capabilities, and the schema it uses. It includes metadata such as the agent's emoji character and a description of its functionality.

- **[studioSchema.ts](./src/studioSchema.ts)**: This file defines the schema for the actions supported by the agent. It includes type definitions for `GetStudioInfoAction`, `ListCollisionsAction`, and `QueryEventsAction`, along with their parameters.

- **[inspect.ts](./src/lib/inspect.ts)**: This file provides pure Markdown formatters for the agent's read-only inspection results. These formatters are designed to be unit-testable and are used to render the output of actions like `getStudioInfo` and `listCollisions`.

- **[studioServiceLifecycle.ts](./src/lib/studioServiceLifecycle.ts)**: This file manages the lifecycle of the Studio service, including the registry server and session context. It ensures that the agent can communicate with the Studio service and handle multiple sessions.

These files collectively define the behavior and capabilities of the `studio-agent` package.

## How to extend

To extend the `studio-agent` package, follow these steps:

1. **Define new actions**:

   - Open [studioSchema.ts](./src/studioSchema.ts).
   - Add a new action type to the `StudioActions` union type. Define the `actionName` and any required parameters for the action.

2. **Implement the action logic**:

   - Open [studioActionHandler.ts](./src/studioActionHandler.ts).
   - Add the implementation for the new action in the `executeAction` function. Use helper functions and formatters from [inspect.ts](./src/lib/inspect.ts) or create new ones as needed.

3. **Update the manifest**:

   - Modify [studioManifest.json](./src/studioManifest.json) to include the new action in the schema. Ensure the manifest accurately reflects the agent's updated capabilities.

4. **Write tests**:

   - Create unit tests for the new action and any associated helper functions or formatters. Place these tests in an appropriate directory, such as `./tests/`.

5. **Test the integration**:
   - Run the agent in the TypeAgent Studio environment to verify that the new action works as expected. Use the `queryEvents` action to monitor the agent's behavior and debug any issues.

By following these steps, you can add new functionality to the `studio-agent` package and enhance its ability to interact with the TypeAgent Studio runtime.

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

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter studio-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
