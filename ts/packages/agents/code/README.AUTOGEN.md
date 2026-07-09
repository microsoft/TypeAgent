<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=2a8f9ea58679244d9dddd4479087549111fd0f23a8077438d502b6d00fccad27 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# code-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `code-agent` package is a TypeAgent application agent designed to automate tasks within Visual Studio Code (VSCode). It serves as a dispatcher for code-related actions, enabling users to interact with VSCode through natural language commands. This agent is integrated with the VSCode extension [coda](../../coda/README.md), which must be deployed to utilize its functionality.

## What it does

The `code-agent` currently implements the `launchVSCode` action, which allows users to launch or start VSCode in various modes:

- **last**: Opens the last session.
- **folder**: Opens a specific folder (requires a `path` parameter).
- **workspace**: Opens a specific workspace (requires a `path` parameter).

The agent is designed to handle a hierarchical set of actions, as defined in its schema. While only the `launchVSCode` action is implemented, the schema outlines additional actions that can be developed in the future, such as:

- Changing the color theme of the editor.
- Splitting the editor into multiple panes.
- Adjusting the editor layout.
- Creating new files (e.g., code files, markdown files, text files).

These actions are not yet implemented but provide a roadmap for extending the agent's capabilities.

## Setup

To set up the `code-agent`, follow these steps:

1. **Set the WebSocket Port**:

   - Define the `CODE_WEBSOCKET_PORT` environment variable. This specifies the port on which the WebSocket server will listen for connections from the VSCode extension.

2. **Deploy the VSCode Extension**:

   - Deploy the [coda](../../coda/README.md) VSCode extension. This is required for the `code-agent` to function.

3. **Enable the Agent**:
   - Use the TypeAgent CLI or shell to enable the `code-agent` and its sub-agents:
     ```sh
     @config agent code*
     @config agent code.code-debug
     ```

For more details on the setup process, refer to the hand-written README.

## Key Files

The `code-agent` package is organized into several key files, each serving a specific purpose:

- **[codeManifest.json](./src/codeManifest.json)**: Defines the agent's manifest, including its description, schema, and sub-agents.
- **[codeActionsSchema.ts](./src/codeActionsSchema.ts)**: Specifies the schema for all actions, including their names, parameters, and types.
- **[codeSchema.agr](./src/codeSchema.agr)**: Contains the natural language grammar for mapping user commands to actions.
- **[codeActionHandler.ts](./src/codeActionHandler.ts)**: Implements the logic for handling actions, such as `launchVSCode`.
- **[codeAgentWebSocketServer.ts](./src/codeAgentWebSocketServer.ts)**: Manages the WebSocket server that facilitates communication between the `code-agent` and the VSCode extension.
- **[originAllowlist.ts](./src/originAllowlist.ts)**: Defines the origin allowlist for the WebSocket server, ensuring secure connections.

## How to extend

To extend the `code-agent` package, you can add new actions or enhance existing functionality. Follow these steps:

1. **Define a New Action**:

   - Add the new action to [codeActionsSchema.ts](./src/codeActionsSchema.ts). Specify the action name and its parameters.

2. **Update the Grammar**:

   - Modify [codeSchema.agr](./src/codeSchema.agr) to include the new action. This enables the agent to recognize natural language commands for the action.

3. **Implement the Action Handler**:

   - Extend the logic in [codeActionHandler.ts](./src/codeActionHandler.ts) to process the new action and execute the corresponding commands.

4. **Test the New Action**:

   - Add test cases for the new action in [codeSchema.tests.json](./src/codeSchema.tests.json). This ensures the action behaves as expected.

5. **Update the Manifest**:

   - If the new action is part of a sub-agent, update [codeManifest.json](./src/codeManifest.json) to include the sub-agent's schema and description.

6. **Run Tests**:
   - Use the existing test framework to validate your changes. Ensure that all tests pass before committing your updates.

By following these steps, you can expand the capabilities of the `code-agent` to support additional VSCode automation tasks. Start by reviewing [codeActionsSchema.ts](./src/codeActionsSchema.ts) and [codeActionHandler.ts](./src/codeActionHandler.ts) to understand the existing patterns and structure.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/codeManifest.json](./src/codeManifest.json)
- `./agent/handlers` → `./dist/codeActionHandler.js` _(not found on disk)_

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

_1 action implemented by this agent, parsed deterministically from `./src/codeActionsSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature. 6 additional actions are declared in the schema but not yet implemented; not shown._

| User says                | Action                                |
| ------------------------ | ------------------------------------- |
| _Launch or Start VSCode_ | `launchVSCode` → `{ "mode": "last" }` |

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter code-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
