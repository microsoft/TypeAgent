<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=2e6939e4afd8f137870d24526579728e764f41e9f2019ecaaffce78e51151539 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# code-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `code-agent` package is a TypeAgent application agent designed to automate tasks within Visual Studio Code (VSCode). It acts as a dispatcher for various code-related actions, enabling users to interact with VSCode through natural language commands.

## What it does

The `code-agent` package primarily handles actions related to VSCode automation. Currently, it implements the `launchVSCode` action, which allows users to launch or start VSCode in different modes such as "last", "folder", or "workspace". The agent is integrated with the VSCode extension [coda](../../coda/README.md), which must be deployed to see the code agent in action.

The package also defines several other actions in its schema, although they are not yet implemented. These include actions for changing the color theme, splitting the editor, changing the editor layout, and creating new files of various types.

## Setup

To set up the `code-agent`, you need to configure the environment variable `CODE_WEBSOCKET_PORT`. This variable specifies the port on which the WebSocket server will listen for connections from the VSCode extension.

1. Set the `CODE_WEBSOCKET_PORT` environment variable to the desired port number.
2. Deploy the VSCode extension [coda](../../coda/README.md) to enable the code agent.
3. Enable the code agent and its sub-agents using the TypeAgent CLI or shell commands:
   ```sh
   @config agent code*
   @config agent code.code-debug
   ```

For detailed setup instructions, see the hand-written README.

## Key Files

The `code-agent` package is structured around several key components:

- **Manifest**: The agent manifest is defined in [codeManifest.json](./src/codeManifest.json), which describes the agent and its sub-agents.
- **Schema**: The action schema is defined in [codeActionsSchema.ts](./src/codeActionsSchema.ts), specifying the types and parameters for each action.
- **Grammar**: The natural language interface for code editor actions is defined in [codeSchema.agr](./src/codeSchema.agr).
- **Handler**: The action handler is implemented in [codeActionHandler.ts](./src/codeActionHandler.ts), which processes incoming actions and executes the corresponding commands.
- **WebSocket Server**: The WebSocket server is implemented in [codeAgentWebSocketServer.ts](./src/codeAgentWebSocketServer.ts), facilitating communication between the code agent and the VSCode extension.

## How to extend

To extend the `code-agent` package, follow these steps:

1. **Add a new action**: Define the new action in [codeActionsSchema.ts](./src/codeActionsSchema.ts). Specify the action name and parameters.
2. **Update the grammar**: Add the new action to the grammar in [codeSchema.agr](./src/codeSchema.agr) to enable natural language processing for the action.
3. **Implement the handler**: Extend the action handler in [codeActionHandler.ts](./src/codeActionHandler.ts) to process the new action and execute the corresponding commands.
4. **Test the new action**: Add test cases for the new action in [codeSchema.tests.json](./src/codeSchema.tests.json) to ensure it works as expected.

Start by opening [codeActionsSchema.ts](./src/codeActionsSchema.ts) and [codeActionHandler.ts](./src/codeActionHandler.ts). Follow the existing patterns for defining and handling actions. Run the tests to verify your changes.

By following these steps, you can add new capabilities to the `code-agent` package and enhance its functionality for automating tasks within VSCode.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/codeManifest.json](./src/codeManifest.json)
- `./agent/handlers` → [./dist/codeActionHandler.js](./dist/codeActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [websocket-utils](../../../packages/utils/webSocketUtils/README.md)

External: `better-sqlite3`, `chalk`, `debug`, `ws`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/codeActionHandler.ts`, `./src/codeActionsSchema.ts`, `./src/codeManifest.json`, …and 26 more under `./src/`.

### Agent surface

- Manifest: [./src/codeManifest.json](./src/codeManifest.json)
- Schema: [./src/codeActionsSchema.ts](./src/codeActionsSchema.ts)
- Grammar: [./src/codeSchema.agr](./src/codeSchema.agr)
- Handler: [./src/codeActionHandler.ts](./src/codeActionHandler.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `CODE_WEBSOCKET_PORT`

### Actions

_1 action implemented by this agent, parsed deterministically from `./src/codeActionsSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature. 6 additional actions are declared in the schema but not yet implemented; not shown._

| User says                | Action                                |
| ------------------------ | ------------------------------------- |
| _Launch or Start VSCode_ | `launchVSCode` → `{ "mode": "last" }` |

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.413Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter code-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
