<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=2118e1b43c469efd3e6d488b13f46b0d476d3fc73a11b9b3816953c1cd36baea -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# desktop-automation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `desktop-automation` package is a TypeAgent application agent designed to automate and control desktop environments on Windows systems. It integrates with Windows shell APIs via a .NET component to perform a variety of desktop-related actions, such as managing windows, launching applications, and adjusting system settings. This package is particularly useful for automating repetitive tasks or creating custom workflows for desktop management.

## What it does

The `desktop-automation` package enables a wide range of desktop automation tasks by providing a set of predefined actions. These actions are defined in the [actionsSchema.ts](./src/actionsSchema.ts) file and are processed by the [actionHandler.ts](./src/actionHandler.ts) file. The package communicates with a .NET component (`autoShell.exe`) to execute these actions on a Windows system.

### Key Capabilities

The following are some of the key actions supported by this package:

- **Program Management**:

  - `LaunchProgram`: Launch a specified program.
  - `CloseProgram`: Close a specified program.
  - `SwitchToWindow`: Switch focus to a specific window.

- **Window Management**:

  - `TileWindows`: Arrange windows in a specified layout.
  - `MaximizeWindow`: Maximize a specific window.
  - `MinimizeWindow`: Minimize a specific window.
  - `MoveWindowToDesktop`: Move a window to a different virtual desktop.

- **System Settings**:

  - `SetVolume`, `AdjustVolume`, `MuteVolume`: Manage system volume.
  - `SetWallpaper`: Change the desktop wallpaper.
  - `SetScreenResolution`: Adjust screen resolution.
  - `SetTextSize`: Modify text size on the screen.

- **Network and Connectivity**:

  - `ConnectWifi`, `DisconnectWifi`, `ListWifiNetworks`: Manage Wi-Fi connections.
  - `ToggleAirplaneMode`: Enable or disable airplane mode.
  - `BluetoothToggleAction`: Toggle Bluetooth settings.

- **Desktop Management**:

  - `CreateDesktop`, `SwitchDesktop`, `NextDesktop`, `PreviousDesktop`: Manage virtual desktops.
  - `PinWindowToAllDesktops`: Pin a window to all virtual desktops.

- **Other Utilities**:
  - `ToggleNotifications`: Enable or disable system notifications.
  - `DebugAutoShell`: Debug the `autoShell.exe` component.

These actions allow for comprehensive control over the desktop environment, making the package a versatile tool for automation tasks.

## Setup

To use the `desktop-automation` package, you need to configure and build both its .NET and TypeAgent components. Additionally, you must set an environment variable to specify the path to the `autoShell.exe` binary.

### Steps to Build and Configure

1. **Build the .NET Component**:

   - Open Visual Studio.
   - Navigate to the `dotnet/autoShell` directory in the repository.
   - Build the project to generate the `autoShell.exe` binary.

2. **Build the TypeAgent Component**:

   - Navigate to the `ts/packages/agents/desktop` directory.
   - Run the following command to build the TypeAgent application agent:
     ```sh
     pnpm run build
     ```

3. **Set the Environment Variable**:

   - Define the `AUTOSHELL_PATH` environment variable to point to the location of the `autoShell.exe` binary. For example:
     ```sh
     export AUTOSHELL_PATH=/path/to/autoShell.exe
     ```

4. **Run the Automation**:
   - Launch the [TypeAgent Shell](../../shell) or the [TypeAgent CLI](../../cli).
   - Enable the `desktop-automation` agent by running:
     ```sh
     @config agent desktop
     ```
   - You can now issue commands such as:
     - `launch calculator`
     - `maximize calculator`
     - `tile calculator to the left and chrome to the right`

For additional details, refer to the hand-written README.

## Key Files

The `desktop-automation` package is organized into several key files, each serving a specific purpose:

- **[manifest.json](./src/manifest.json)**: Defines the agent's metadata, including its description, schema, and grammar files.
- **[actionsSchema.ts](./src/actionsSchema.ts)**: Contains the TypeScript definitions for all supported actions, such as `LaunchProgram`, `CloseProgram`, and `SetVolume`.
- **[desktopSchema.agr](./src/desktopSchema.agr)**: Defines the grammar for parsing user commands into structured actions.
- **[actionHandler.ts](./src/actionHandler.ts)**: Implements the logic for handling actions and interacting with the .NET component.
- **[connector.ts](./src/connector.ts)**: Manages the communication between the TypeAgent and the `autoShell.exe` binary, including executing desktop actions.
- **[readiness.ts](./src/readiness.ts)**: Contains logic to check the readiness of the `autoShell.exe` binary and the overall desktop automation environment.
- **[programNameIndex.ts](./src/programNameIndex.ts)**: Handles program name indexing and similarity matching for user commands.

## How to extend

To add new features or actions to the `desktop-automation` package, follow these steps:

1. **Define New Actions**:

   - Add new action types to [actionsSchema.ts](./src/actionsSchema.ts).
   - Update the grammar in [desktopSchema.agr](./src/desktopSchema.agr) to include the new actions.

2. **Implement Action Handlers**:

   - Extend the [actionHandler.ts](./src/actionHandler.ts) file to include the logic for the new actions.
   - Use the `connector.ts` file to interact with the `autoShell.exe` binary if the new actions require communication with the .NET component.

3. **Update the Manifest**:

   - Add descriptions and schema references for the new actions in [manifest.json](./src/manifest.json).

4. **Test Your Changes**:

   - Write unit tests for the new actions and their handlers.
   - Run the tests to ensure the new functionality works as expected.

5. **Build and Deploy**:
   - Rebuild the .NET and TypeAgent components as described in the setup section.
   - Verify the new actions are correctly recognized and executed by the agent.

By following these steps, you can enhance the `desktop-automation` package to support additional desktop automation capabilities.

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter desktop-automation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
