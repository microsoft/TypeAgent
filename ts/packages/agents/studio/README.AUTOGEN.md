<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=0eb39cc641ff1541cb307d5c0dc40f462c421df4ae15e3d85c21d52cefcbfd94 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# studio-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `studio-agent` package is a TypeAgent application agent designed to interact with the TypeAgent Studio runtime. It serves as the AI conversational presenter, facilitating inspection, validation, and authoring processes within the Studio environment. This agent currently supports actions to report Studio's environment, list grammar collisions, and query recent events.

## What it does

The `studio-agent` package provides three main actions:

- `getStudioInfo`: Reports the Studio environment, including the repository root and directories scanned for agents, along with the count of agent packages in each directory. This action is useful for confirming that Studio is pointed at the correct location.
- `listCollisions`: Lists the cross-schema grammar collisions that Studio knows about, ordered from newest to oldest. This list is populated by collision scans and remains empty until a scan has been performed.
- `queryEvents`: Displays the most recent entries from Studio's structured event stream, including sandbox, collision, replay, and feedback events. The results are shown from oldest to newest, with an optional limit on the number of events returned.

These actions are read-only and help users inspect the current state and activities within the Studio environment.

## Setup

To set up the `studio-agent` package, ensure the following environment variable is configured:

- `STUDIO_REGISTRY_PORT`: This variable specifies the port on which the Studio registry server will run. The hand-written README may provide additional details on how to obtain and set this value.

## Key Files

The `studio-agent` package consists of several key files that define its functionality:

- [studioActionHandler.ts](./src/studioActionHandler.ts): Contains the main logic for handling actions. It includes functions to initialize, update, and close the agent context, as well as execute actions.
- [studioManifest.json](./src/studioManifest.json): Defines the agent's manifest, including its description, emoji character, and schema details.
- [studioSchema.ts](./src/studioSchema.ts): Specifies the types for the actions supported by the agent, including `GetStudioInfoAction`, `ListCollisionsAction`, and `QueryEventsAction`.
- [inspect.ts](./src/lib/inspect.ts): Provides pure Markdown formatters for the agent's read-only inspect results, making them easily unit-testable.
- [studioServiceLifecycle.ts](./src/lib/studioServiceLifecycle.ts): Manages the lifecycle of the Studio service, including the registry server and session context.

## How to extend

To extend the `studio-agent` package, follow these steps:

1. **Open the `studioSchema.ts` file**: Define new action types by adding them to the `StudioActions` union type. Ensure each action has a unique `actionName` and appropriate parameters.
2. **Update the `studioActionHandler.ts` file**: Implement the logic for the new actions within the `executeAction` function. Use helper functions and formatters as needed to process and return results.
3. **Modify the `studioManifest.json` file**: Update the schema details to include the new actions, ensuring the manifest accurately reflects the agent's capabilities.
4. **Add unit tests**: Create unit tests for the new actions and formatters to ensure they work as expected. Place these tests in a suitable directory, such as `./tests/`.

By following these steps, you can extend the functionality of the `studio-agent` package to support additional actions and enhance its capabilities within the TypeAgent Studio environment.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/studioManifest.json](./src/studioManifest.json)
- `./agent/handlers` → [./dist/studioActionHandler.js](./dist/studioActionHandler.js)

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

`./src/studioActionHandler.ts`, `./src/studioManifest.json`, `./src/studioSchema.ts`, …and 3 more under `./src/`.

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter studio-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
