<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ce3ceb51c5671c6ffe38b212cd5b2eab88aa7d2d0749fb683d97d961673023bb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# desktop-automation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `desktop-automation` package is a TypeAgent application agent designed to automate and manage desktop environments on Windows systems. It integrates with Windows shell APIs via a .NET component to perform tasks such as managing application windows, customizing desktop settings, and controlling system features. Users can interact with the agent through natural language commands issued via the TypeAgent Shell or CLI.

## What it does

The `desktop-automation` package provides a wide range of actions to control and automate various aspects of a Windows desktop environment. These actions are defined in the [actionsSchema.ts](./src/actionsSchema.ts) file and implemented in [actionHandler.ts](./src/actionHandler.ts). The agent communicates with the `autoShell.exe` binary, a .NET application that interfaces with Windows shell APIs, to execute these actions.

### Key Capabilities

1. **Application Management**:

   - Actions like `LaunchProgram`, `CloseProgram`, and `SwitchToWindow` allow users to start, stop, and switch between applications.

2. **Window Management**:

   - Actions such as `TileWindows`, `MaximizeWindow`, `MinimizeWindow`, and `MoveWindowToDesktop` enable users to organize and manipulate application windows.

3. **System Settings**:

   - Actions like `SetVolume`, `MuteVolume`, `SetWallpaper`, and `SetScreenResolution` allow users to control audio, display, and other system settings.

4. **Network Management**:

   - Actions such as `ConnectWifi`, `DisconnectWifi`, and `ToggleAirplaneMode` provide control over network connectivity.

5. **Desktop Customization**:
   - Actions like `ChangeThemeMode`, `ApplyTheme`, and `SetTextSize` allow users to personalize their desktop environment.

These capabilities make the `desktop-automation` package a versatile tool for automating repetitive tasks, managing system settings, and customizing the desktop environment.

## Setup

To set up the `desktop-automation` package, follow these steps:

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
   - Define the `AUTOSHELL_PATH` environment variable to point to the location of the `autoShell.exe` binary generated in step 1. For example:
     ```sh
     export AUTOSHELL_PATH=/path/to/autoShell.exe
     ```

Once these steps are complete, the package will be ready to use with the TypeAgent Shell or CLI. For more details, refer to the hand-written README.

## Key Files

The `desktop-automation` package is organized into several key files, each with a specific role:

- **[manifest.json](./src/manifest.json)**: Contains metadata about the agent, including its description, default settings, and references to schema and grammar files.
- **[actionsSchema.ts](./src/actionsSchema.ts)**: Defines the TypeScript types for all supported actions, such as `LaunchProgram`, `SetVolume`, and `TileWindows`.
- **[desktopSchema.agr](./src/desktopSchema.agr)**: Specifies the grammar for parsing user commands into structured actions.
- **[actionHandler.ts](./src/actionHandler.ts)**: Implements the logic for processing actions. This file is the core of the agent's functionality, handling requests and interfacing with the .NET component.
- **[connector.ts](./src/connector.ts)**: Manages communication between the TypeAgent runtime and the `autoShell.exe` binary, ensuring that actions are executed correctly.
- **[readiness.ts](./src/readiness.ts)**: Provides utility functions to verify the readiness of the `autoShell.exe` binary and ensure the environment is properly configured.

## How to extend

To add new features or actions to the `desktop-automation` package, follow these steps:

1. **Define New Actions**:

   - Add new action types to [actionsSchema.ts](./src/actionsSchema.ts). For example, define a new action type with its name and required parameters.

2. **Update the Grammar**:

   - Modify [desktopSchema.agr](./src/desktopSchema.agr) to include the new actions. This ensures that user commands can be parsed into the new action types.

3. **Implement Action Handlers**:

   - Add the logic for the new actions in [actionHandler.ts](./src/actionHandler.ts). This is where you define how the agent processes the new actions and interacts with the .NET component.

4. **Update the Manifest**:

   - Add descriptions and schema references for the new actions in [manifest.json](./src/manifest.json).

5. **Test Your Changes**:

   - Write unit tests for the new actions and their handlers.
   - Run the tests to verify that the new functionality works as expected.

6. **Update the .NET Component (if needed)**:
   - If the new actions require additional functionality in the `autoShell.exe` binary, update the .NET code in the `dotnet/autoShell` directory and rebuild the project.

By following these steps, you can extend the `desktop-automation` package to support additional desktop automation tasks. The modular design of the package makes it straightforward to add new features while maintaining existing functionality.

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

`./src/actionHandler.ts`, `./src/actionsSchema.ts`, `./src/desktopSchema.agr`, …and 28 more under `./src/`.

### Agent surface

- Manifest: [./src/manifest.json](./src/manifest.json)
- Schema: [./src/actionsSchema.ts](./src/actionsSchema.ts)
- Grammar: [./src/desktopSchema.agr](./src/desktopSchema.agr)
- Handler: [./src/actionHandler.ts](./src/actionHandler.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AUTOSHELL_PATH`

### Actions

_32 actions declared in the schema, none yet implemented in [`./src/actionHandler.ts`]._

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter desktop-automation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
