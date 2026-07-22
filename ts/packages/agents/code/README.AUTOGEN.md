<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=dd198ff53607a677a579f0cca2add29021d07462af9f5e672fb5c9e1e9f3eeb6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# code-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `code-agent` package is a TypeAgent application agent designed to automate tasks in Visual Studio Code (VSCode). It acts as a dispatcher for code-related actions, enabling users to interact with VSCode through natural language commands. This agent integrates with the [coda](../../coda/README.md) VSCode extension, which must be deployed for the `code-agent` to function. The agent is not enabled by default and requires explicit configuration to activate.

## What it does

The `code-agent` currently implements the `launchVSCode` action, which allows users to launch or start VSCode in different modes:

- **last**: Opens the last session.
- **folder**: Opens a specific folder (requires a `path` parameter).
- **workspace**: Opens a specific workspace (requires a `path` parameter).

The agent is designed to support a hierarchical set of actions, as defined in its schema. While only `launchVSCode` is implemented, the schema includes additional actions that are not yet implemented, such as:

- Changing the color theme of the editor.
- Splitting the editor into multiple panes.
- Changing the editor layout.
- Creating new files (e.g., code files, markdown files, text files).

The `code-agent` communicates with the [coda](../../coda/README.md) VSCode extension via a WebSocket server. This integration allows the agent to execute commands in the VSCode environment, making it a useful tool for automating development workflows.

## Setup

To set up the `code-agent`, follow these steps:

1. **Set the WebSocket port**:

   - Define the `CODE_WEBSOCKET_PORT` environment variable. This specifies the port on which the WebSocket server will listen for connections from the VSCode extension.

2. **Deploy the VSCode extension**:

   - Install and deploy the [coda](../../coda/README.md) VSCode extension. This is required for the `code-agent` to function.

3. **Enable the agent and sub-agents**:
   - Use the TypeAgent CLI or shell to enable the `code-agent` and its sub-agents:
     ```sh
     @config agent code*
     @config agent code.code-debug
     ```

For more details on the setup process, refer to the hand-written README.

## Key Files

The `code-agent` package is organized into several key files, each serving a specific purpose:

- **[codeManifest.json](./src/codeManifest.json)**: Defines the agent's manifest, including its description, schema, and sub-agents. It is the starting point for understanding the agent's structure and capabilities.
- **[codeActionsSchema.ts](./src/codeActionsSchema.ts)**: Specifies the schema for all actions supported by the agent, including their names and parameters. For example, the `launchVSCode` action is defined here.
- **[codeSchema.agr](./src/codeSchema.agr)**: Contains the natural language grammar for mapping user commands to actions. This enables the agent to interpret user input and match it to the appropriate action.
- **[codeActionHandler.ts](./src/codeActionHandler.ts)**: Implements the logic for handling actions. For instance, the `launchVSCode` action is processed here.
- **[codeAgentWebSocketServer.ts](./src/codeAgentWebSocketServer.ts)**: Implements the WebSocket server that facilitates communication between the `code-agent` and the [coda](../../coda/README.md) VSCode extension.
- **[originAllowlist.ts](./src/originAllowlist.ts)**: Defines the origin allowlist for the WebSocket server, ensuring secure communication by restricting connections to trusted origins.

## How to extend

To add new functionality to the `code-agent`, follow these steps:

1. **Define a new action**:

   - Add the new action to [codeActionsSchema.ts](./src/codeActionsSchema.ts). Specify the action name and its parameters.

2. **Update the grammar**:

   - Extend the natural language grammar in [codeSchema.agr](./src/codeSchema.agr) to include the new action. This allows the agent to recognize user commands related to the action.

3. **Implement the action handler**:

   - Modify [codeActionHandler.ts](./src/codeActionHandler.ts) to handle the new action. Implement the logic for executing the action's commands.

4. **Test the new action**:

   - Add test cases for the new action in [codeSchema.tests.json](./src/codeSchema.tests.json). Ensure the action behaves as expected under various scenarios.

5. **Update the manifest (if needed)**:
   - If the new action introduces a new sub-agent or requires additional configuration, update [codeManifest.json](./src/codeManifest.json) accordingly.

### Example: Adding a "Change Color Theme" Action

1. **Define the action**:

   - Add a `ChangeColorThemeAction` type to [codeActionsSchema.ts](./src/codeActionsSchema.ts), specifying the `theme` parameter.

2. **Update the grammar**:

   - Add rules for the action in [codeSchema.agr](./src/codeSchema.agr), mapping user-friendly phrases like "change my theme to Monokai" to the action.

3. **Implement the handler**:

   - Extend the logic in [codeActionHandler.ts](./src/codeActionHandler.ts) to process the `ChangeColorThemeAction` and apply the specified theme in VSCode.

4. **Test the action**:
   - Add test cases in [codeSchema.tests.json](./src/codeSchema.tests.json) to validate the action.

By following these steps, you can extend the `code-agent` to support additional VSCode automation tasks.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/codeManifest.json](./src/codeManifest.json)
- `./agent/handlers` → [./dist/codeActionHandler.js](./dist/codeActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/websocket-utils](../../../packages/utils/webSocketUtils/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [websocket-channel-server](../../../packages/utils/webSocketChannelServer/README.md)

External: `better-sqlite3`, `chalk`, `debug`, `ws`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/codeActionHandler.ts`, `./src/codeActionsSchema.ts`, `./src/codeManifest.json`, …and 40 more under `./src/`.

### Agent surface

- Manifest: [./src/codeManifest.json](./src/codeManifest.json)
- Schema: [./src/codeActionsSchema.ts](./src/codeActionsSchema.ts)
- Grammar: [./src/codeSchema.agr](./src/codeSchema.agr)
- Handler: [./src/codeActionHandler.ts](./src/codeActionHandler.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `CODE_WEBSOCKET_PORT`

### Actions

_1 action implemented by this agent, parsed deterministically from `./src/codeActionsSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature. 12 additional actions are declared in the schema but not yet implemented; not shown._

| User says                | Action                                |
| ------------------------ | ------------------------------------- |
| _Launch or Start VSCode_ | `launchVSCode` → `{ "mode": "last" }` |

---

_Auto-generated against commit `6bea19a9ee02598644b1ac3ab67c705dcc495832` on `2026-07-22T11:19:17.632Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter code-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
