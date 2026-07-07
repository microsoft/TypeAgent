<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=2118e1b43c469efd3e6d488b13f46b0d476d3fc73a11b9b3816953c1cd36baea -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# desktop-automation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `desktop-automation` package is a TypeAgent application agent designed to automate and manage desktop environments on Windows systems. It integrates with Windows shell APIs via a .NET component to perform a variety of desktop-related actions, such as managing windows, launching applications, and controlling system settings.

This package is part of the TypeAgent ecosystem and works in conjunction with the TypeAgent Shell or CLI to execute user commands for desktop automation.

## What it does

The `desktop-automation` package enables a wide range of desktop automation tasks by providing a set of predefined actions. These actions are defined in the [actionsSchema.ts](./src/actionsSchema.ts) file and are processed by the [actionHandler.ts](./src/actionHandler.ts) file. The package communicates with a .NET component (`autoShell.exe`) to interact with Windows shell APIs.

Some of the key actions include:

- **Program Management**: Actions like `LaunchProgram`, `CloseProgram`, and `SwitchToWindow` allow users to control application windows.
- **Window Layout**: Actions such as `TileWindows`, `MaximizeWindow`, and `MinimizeWindow` help manage window arrangements.
- **System Settings**: Actions like `SetVolume`, `SetWallpaper`, and `SetScreenResolution` allow users to adjust system settings.
- **Network Management**: Actions such as `ConnectWifi`, `DisconnectWifi`, and `ToggleAirplaneMode` enable control over network settings.
- **Desktop Customization**: Actions like `SetTextSize`, `ChangeThemeMode`, and `ApplyTheme` allow users to personalize their desktop environment.

These actions are designed to provide a comprehensive set of tools for managing and automating tasks on a Windows desktop.

## Setup

To use the `desktop-automation` package, you need to complete the following setup steps:

1. **Build the .NET Component**:

   - Open Visual Studio.
   - Navigate to the `dotnet/autoShell` directory in the repository.
   - Build the project to generate the `autoShell.exe` binary.

2. **Build the TypeAgent Component**:

   - Navigate to the `ts/packages/agents/desktop` directory (this package's root).
   - Run the following command to build the TypeAgent application agent:
     ```sh
     pnpm run build
     ```

3. **Set the Environment Variable**:
   - Define the `AUTOSHELL_PATH` environment variable to point to the location of the `autoShell.exe` binary generated in step 1.

For additional details, refer to the hand-written README.

## Key Files

The `desktop-automation` package is organized into several key files, each responsible for specific functionality:

- **[manifest.json](./src/manifest.json)**: Defines the agent's metadata, including its description, default settings, and references to schema and grammar files.
- **[actionsSchema.ts](./src/actionsSchema.ts)**: Contains the TypeScript definitions for all supported actions, such as `LaunchProgram`, `SetVolume`, and `TileWindows`.
- **[desktopSchema.agr](./src/desktopSchema.agr)**: Defines the grammar for parsing user commands into structured actions.
- **[actionHandler.ts](./src/actionHandler.ts)**: Implements the logic for handling actions. This is where the agent processes incoming requests and interacts with the .NET component.
- **[connector.ts](./src/connector.ts)**: Manages the connection between the TypeAgent runtime and the `autoShell.exe` binary, facilitating the execution of desktop actions.
- **[readiness.ts](./src/readiness.ts)**: Contains utility functions to check the readiness of the `autoShell.exe` binary and ensure the environment is correctly configured.

## How to extend

To add new functionality to the `desktop-automation` package, follow these steps:

1. **Define New Actions**:

   - Add new action types to [actionsSchema.ts](./src/actionsSchema.ts). For example, you can define a new action type with its name and parameters.

2. **Update the Grammar**:

   - Modify [desktopSchema.agr](./src/desktopSchema.agr) to include the new actions. This ensures that user commands can be correctly parsed into the new action types.

3. **Implement Action Handlers**:

   - Add the logic for the new actions in [actionHandler.ts](./src/actionHandler.ts). This is where you define how the agent should process the new actions and interact with the .NET component.

4. **Update the Manifest**:

   - Add descriptions and schema references for the new actions in [manifest.json](./src/manifest.json).

5. **Test Your Changes**:
   - Write unit tests for the new actions and their handlers.
   - Run the tests to verify that the new functionality works as expected.

By following these steps, you can extend the `desktop-automation` package to support additional desktop automation tasks. This modular design allows for easy integration of new features while maintaining the existing functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/manifest.json](./src/manifest.json)
- `./agent/handlers` → `./dist/actionHandler.js` _(not found on disk)_

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter desktop-automation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
