<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6ed71f8e665806eef369f1c14a975a12b6552704b2c85ad1bca8298a0d73680c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# desktop-automation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `desktop-automation` package is a TypeAgent application agent designed to manage and control desktop environments on Windows systems. It integrates with Windows shell APIs to perform various actions such as launching programs, managing windows, adjusting display settings, and more.

## What it does

This package provides a wide range of actions to control and automate desktop tasks. Some of the key actions include:

- `LaunchProgram`: Launches a specified program.
- `CloseProgram`: Closes a specified program.
- `TileWindows`: Arranges windows in a specified layout.
- `MaximizeWindow`: Maximizes a specified window.
- `MinimizeWindow`: Minimizes a specified window.
- `SetVolume`: Adjusts the system volume.
- `SetWallpaper`: Changes the desktop wallpaper.
- `ConnectWifi`: Connects to a specified Wi-Fi network.
- `ToggleAirplaneMode`: Toggles the airplane mode on or off.

These actions are defined in the [actionsSchema.ts](./src/actionsSchema.ts) file and are handled by the [actionHandler.ts](./src/actionHandler.ts) file.

## Setup

To set up the `desktop-automation` package, you need to configure the following environment variable:

- `AUTOSHELL_PATH`: Path to the `autoShell.exe` binary. This binary is built from the .NET code located in the `dotnet/autoShell` directory.

### Steps to build and configure

1. **Build the .NET component**:

   - Open Visual Studio.
   - Navigate to the `dotnet/autoShell` directory.
   - Build the project to generate the `autoShell.exe` binary.

2. **Build the TypeAgent component**:

   - Navigate to the `ts/packages/agents/desktop` directory.
   - Run `pnpm run build` to build the TypeAgent application agent.

3. **Set the environment variable**:
   - Ensure the `AUTOSHELL_PATH` environment variable points to the location of the `autoShell.exe` binary.

For detailed setup instructions, see the hand-written README.

## Key Files

The `desktop-automation` package is structured as follows:

- **Manifest**: The agent's manifest is defined in [manifest.json](./src/manifest.json), which includes descriptions and schema files for the agent and its sub-actions.
- **Schema**: The actions schema is defined in [actionsSchema.ts](./src/actionsSchema.ts), which lists all possible actions the agent can perform.
- **Grammar**: The grammar for parsing user commands is defined in [desktopSchema.agr](./src/desktopSchema.agr).
- **Handler**: The main action handler is implemented in [actionHandler.ts](./src/actionHandler.ts), which processes incoming actions and interacts with the .NET component.
- **Connector**: The [connector.ts](./src/connector.ts) file manages the connection between the TypeAgent and the .NET component, handling the execution of desktop actions.

## How to extend

To extend the `desktop-automation` package, follow these steps:

1. **Add new actions**:

   - Define new action types in [actionsSchema.ts](./src/actionsSchema.ts).
   - Update the grammar in [desktopSchema.agr](./src/desktopSchema.agr) to include the new actions.

2. **Implement action handlers**:

   - Add the logic for handling new actions in [actionHandler.ts](./src/actionHandler.ts).

3. **Update the manifest**:

   - Modify [manifest.json](./src/manifest.json) to include descriptions and schema files for the new actions.

4. **Test your changes**:
   - Write unit tests for the new actions and handlers.
   - Run the tests to ensure everything works as expected.

By following these steps, you can extend the functionality of the `desktop-automation` package to support additional desktop automation tasks.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/manifest.json](./src/manifest.json)
- `./agent/handlers` → [./dist/actionHandler.js](./dist/actionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [agent-cache](../../../packages/cache/README.md)
- [typeagent](../../../packages/typeagent/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)

External: `body-parser`, `chalk`, `cors`, `debug`, `dotenv`, `find-config`, `typechat`, `ws`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/actionHandler.ts`, `./src/actionsSchema.ts`, `./src/desktopSchema.agr`, …and 20 more under `./src/`.

### Agent surface

- Manifest: [./src/manifest.json](./src/manifest.json)
- Schema: [./src/actionsSchema.ts](./src/actionsSchema.ts)
- Grammar: [./src/desktopSchema.agr](./src/desktopSchema.agr)
- Handler: [./src/actionHandler.ts](./src/actionHandler.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AUTOSHELL_PATH`

### Actions

_31 actions declared in the schema, none yet implemented in [`./src/actionHandler.ts`]._

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter desktop-automation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
