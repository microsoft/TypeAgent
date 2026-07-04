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

The package supports the following types of actions:

- **Program Management**:

  - `LaunchProgram`: Launch a specified program.
  - `CloseProgram`: Close a specified program.
  - `SwitchToWindow`: Switch focus to a specific window.

- **Window Management**:

  - `TileWindows`: Arrange windows in a specific layout.
  - `MaximizeWindow`: Maximize a window.
  - `MinimizeWindow`: Minimize a window.
  - `MoveWindowToDesktop`: Move a window to a specific virtual desktop.

- **System Settings**:

  - `SetVolume`, `AdjustVolume`, `MuteVolume`: Manage system volume.
  - `SetWallpaper`: Change the desktop wallpaper.
  - `SetScreenResolution`: Adjust screen resolution.
  - `SetTextSize`: Modify text size.

- **Network and Connectivity**:

  - `ConnectWifi`, `DisconnectWifi`, `ListWifiNetworks`: Manage Wi-Fi connections.
  - `ToggleAirplaneMode`: Enable or disable airplane mode.

- **Desktop Management**:

  - `CreateDesktop`, `SwitchDesktop`, `NextDesktop`, `PreviousDesktop`: Manage virtual desktops.
  - `PinWindowToAllDesktops`: Pin a window to all virtual desktops.

- **Other System Features**:
  - `ToggleNotifications`: Enable or disable system notifications.
  - `BluetoothToggleAction`: Manage Bluetooth settings.
  - `EnableWifiAction`: Enable Wi-Fi.
  - `AdjustScreenBrightnessAction`: Adjust screen brightness.

These actions allow users to interact with and control their desktop environment programmatically, making it easier to perform complex tasks or automate workflows.

## Setup

To use the `desktop-automation` package, you need to complete the following setup steps:

### Prerequisites

1. **Build the .NET Component**:

   - Open Visual Studio.
   - Navigate to the `dotnet/autoShell` directory in the repository.
   - Build the project to generate the `autoShell.exe` binary.

2. **Build the TypeAgent Component**:

   - Navigate to the `ts/packages/agents/desktop` directory.
   - Run the following command to build the TypeAgent application agent:
     ```bash
     pnpm run build
     ```

3. **Set the Environment Variable**:
   - Define the `AUTOSHELL_PATH` environment variable to point to the location of the `autoShell.exe` binary generated in step 1. For example:
     ```bash
     export AUTOSHELL_PATH=/path/to/autoShell.exe
     ```

### Running the Automation

Once the setup is complete, you can use the `desktop-automation` agent with the [TypeAgent Shell](../../shell) or the [TypeAgent CLI](../../cli). Enable the agent using the following command:

```bash
@config agent desktop
```

You can then issue commands such as:

- "Launch calculator"
- "Maximize calculator"
- "Tile calculator to the left and Chrome to the right"

Refer to the hand-written README for additional details on running the automation.

## Key Files

The `desktop-automation` package is organized into several key files, each serving a specific purpose:

- **[manifest.json](./src/manifest.json)**: Defines the agent's metadata, including its description, default state, and references to schema and grammar files.
- **[actionsSchema.ts](./src/actionsSchema.ts)**: Contains the TypeScript definitions for all supported actions, such as `LaunchProgram`, `CloseProgram`, and `TileWindows`.
- **[desktopSchema.agr](./src/desktopSchema.agr)**: Specifies the grammar for parsing user commands into structured actions.
- **[actionHandler.ts](./src/actionHandler.ts)**: Implements the logic for handling actions. This is where the agent processes incoming requests and interacts with the .NET component.
- **[connector.ts](./src/connector.ts)**: Manages the communication between the TypeAgent and the `autoShell.exe` binary. It handles the execution of desktop actions and ensures the .NET component is ready to process requests.
- **[readiness.ts](./src/readiness.ts)**: Contains logic to check the readiness of the `autoShell.exe` binary and provides utilities for setting up the environment.
- **[programNameIndex.ts](./src/programNameIndex.ts)**: Manages a searchable index of known program names, enabling the agent to match user commands to specific applications.

## How to extend

To add new features or actions to the `desktop-automation` package, follow these steps:

1. **Define New Actions**:

   - Add new action types to [actionsSchema.ts](./src/actionsSchema.ts).
   - Update the grammar in [desktopSchema.agr](./src/desktopSchema.agr) to include the new actions.

2. **Implement Action Handlers**:

   - Add the logic for handling the new actions in [actionHandler.ts](./src/actionHandler.ts). Use the existing handlers as a reference for implementing new functionality.

3. **Update the Manifest**:

   - Modify [manifest.json](./src/manifest.json) to include descriptions and schema files for the new actions.

4. **Test Your Changes**:

   - Write unit tests for the new actions and their handlers.
   - Run the tests to ensure the new functionality works as expected.

5. **Update Documentation**:
   - Update the hand-written README and any other relevant documentation to reflect the new features.

By following these steps, you can extend the `desktop-automation` package to support additional desktop automation tasks, making it more versatile and tailored to specific use cases.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter desktop-automation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
