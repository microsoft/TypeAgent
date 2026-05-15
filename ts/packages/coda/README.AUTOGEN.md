<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5be03efe189bbce1f519b9b0b28e834a4694c09a7cf359a93ba8c24feb3ddc2c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-coda — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-coda` package is a TypeScript library designed to facilitate coding with voice commands through the Coda Operated Assistance (CODA) system. It integrates with Visual Studio Code (VSCode) to enable users to perform various coding tasks using voice commands.

## What it does

The `agent-coda` package provides a set of actions that can be executed within VSCode to streamline coding workflows. These actions include creating files, changing editor layouts, managing extensions, and debugging configurations. The package listens for commands issued through the TypeAgent shell or CLI and translates them into corresponding VSCode operations.

Key actions include:

- `createFile`: Create a new file with specified parameters.
- `changeEditorColumns`: Adjust the editor layout to single, double, or triple columns.
- `checkExtensionAvailable`: Search for and manage VSCode extensions.
- `startDebugging`: Initiate debugging sessions with specified configurations.
- `openFile`: Open files within the workspace based on given criteria.

## Setup

To set up the `agent-coda` package, you need to configure the following environment variable:

- `CODE_WEBSOCKET_HOST`: The WebSocket host for connecting to the TypeAgent shell or CLI.

Ensure that this environment variable is set in your shell or `.env` file. For detailed setup instructions, see the hand-written README.

## Key Files

The `agent-coda` package is structured into several key components:

- [codeUtils.ts](./src/codeUtils.ts): Utility functions for code manipulation, such as ensuring proper syntax closures and generating documentation comments.
- [commandAliasMgr.ts](./src/commandAliasMgr.ts): Manages command aliases to facilitate easier voice command recognition and execution.
- [extension.ts](./src/extension.ts): The main entry point for the VSCode extension, handling activation and command registration.
- [handleDebugActions.ts](./src/handleDebugActions.ts): Handles actions related to debugging configurations and sessions.
- [handleEditorCodeActions.ts](./src/handleEditorCodeActions.ts): Manages actions related to code editing, such as creating files and inserting code snippets.
- [handleExtensionActions.ts](./src/handleExtensionActions.ts): Manages actions related to VSCode extensions, including searching and installing extensions.
- [handleVSCodeActions.ts](./src/handleVSCodeActions.ts): Handles general VSCode actions, such as changing editor layouts.
- [handleWorkBenchActions.ts](./src/handleWorkBenchActions.ts): Manages actions related to the VSCode workbench, such as opening files and managing workspace folders.

## How to extend

To extend the `agent-coda` package, follow these steps:

1. **Identify the action to extend or add**: Determine whether you need to modify an existing action or create a new one. Actions are typically handled in files like [handleEditorCodeActions.ts](./src/handleEditorCodeActions.ts) or [handleVSCodeActions.ts](./src/handleVSCodeActions.ts).

2. **Modify or add the action handler**: Implement the logic for the new or modified action. Ensure that the action parameters are correctly processed and the desired VSCode operations are performed.

3. **Register the action**: If adding a new action, ensure it is registered in the appropriate handler file and linked to the command in [extension.ts](./src/extension.ts).

4. **Test the action**: Write tests to verify the functionality of the new or modified action. Ensure that the action behaves as expected within the VSCode environment.

5. **Update documentation**: Document the new or modified action, including its parameters and expected behavior. Update the README and any relevant documentation files.

By following these steps, you can extend the functionality of the `agent-coda` package to support additional voice commands and coding workflows.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./out/extension.js](./out/extension.js)

### Dependencies

Workspace: _None._

External: `body-parser`, `chalk`, `cors`, `debug`, `dotenv`, `ws`

### Files of interest

`./src/codeUtils.ts`, `./src/commandAliasMgr.ts`, `./src/extension.ts`, …and 10 more under `./src/`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `CODE_WEBSOCKET_HOST`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-coda docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
