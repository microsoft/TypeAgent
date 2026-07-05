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

The `desktop-automation` package provides a comprehensive set of actions to control and automate desktop tasks. These actions are defined in the [actionsSchema.ts](./src/actionsSchema.ts) file and are processed by the [actionHandler.ts](./src/actionHandler.ts) file. The package communicates with a .NET component (`autoShell.exe`) to execute these actions on a Windows system.

### Key Capabilities

The agent supports a wide range of actions, including but not limited to:

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
  - `SetTextSize`: Modify text size.

- **Network and Connectivity**:

  - `ConnectWifi`, `DisconnectWifi`, `ListWifiNetworks`: Manage Wi-Fi connections.
  - `ToggleAirplaneMode`: Enable or disable airplane mode.

- **Desktop Management**:

  - `CreateDesktop`, `SwitchDesktop`, `NextDesktop`, `PreviousDesktop`: Manage virtual desktops.
  - `PinWindowToAllDesktops`: Pin a window to all virtual desktops.

- **Other Utilities**:
  - `ToggleNotifications`: Enable or disable system notifications.
  - `DebugAutoShell`: Debug the `autoShell.exe` component.

These actions enable users to interact with and control their desktop environment programmatically, making it easier to perform complex tasks or automate workflows.

## Setup

To use the `desktop-automation` package, you need to complete the following setup steps:

### 1. Build the .NET Component

The package relies on a .NET application (`autoShell.exe`) to interface with Windows shell APIs. To build this component:

1. Open Visual Studio.
2. Navigate to the `dotnet/autoShell` directory in the repository.
3. Open the project file and build the solution. This will generate the `autoShell.exe` binary.

### 2. Build the TypeAgent Component

1. Navigate to the `ts/packages/agents/desktop` directory.
2. Run the following command to build the TypeAgent application agent:
   ```bash
   pnpm run build
   ```

### 3. Configure the Environment Variable

Set the `AUTOSHELL_PATH` environment variable to the path of the `autoShell.exe` binary generated in Step 1. This is required for the TypeAgent to locate and communicate with the .NET component.

For additional details, refer to the hand-written README.

## Key Files

The `desktop-automation` package is organized into several key files, each serving a specific purpose:

- **[manifest.json](./src/manifest.json)**: Defines the agent's metadata, including its description, schema, and grammar files. It also specifies sub-action manifests for specialized functionalities like display and personalization settings.

- **[actionsSchema.ts](./src/actionsSchema.ts)**: Contains the TypeScript definitions for all actions supported by the agent. This file is the central repository for defining the structure and parameters of each action.

- **[desktopSchema.agr](./src/desktopSchema.agr)**: Defines the grammar for parsing user commands into structured actions. This file is essential for interpreting natural language inputs.

- **[actionHandler.ts](./src/actionHandler.ts)**: Implements the logic for handling actions. This file is the core of the agent, where actions are processed and dispatched to the .NET component.

- **[connector.ts](./src/connector.ts)**: Manages the communication between the TypeAgent and the `autoShell.exe` binary. It handles the execution of desktop actions and ensures proper error handling.

- **[readiness.ts](./src/readiness.ts)**: Contains utility functions to check the readiness of the `autoShell.exe` binary and the overall desktop environment.

- **[programNameIndex.ts](./src/programNameIndex.ts)**: Provides functionality for managing and searching program names, enabling the agent to recognize and interact with various applications.

## How to extend

To add new features or actions to the `desktop-automation` package, follow these steps:

### 1. Define New Actions

- Add new action types to [actionsSchema.ts](./src/actionsSchema.ts). For example, if you want to add an action to lock the screen, define a new action type with its parameters and expected behavior.

### 2. Update the Grammar

- Modify [desktopSchema.agr](./src/desktopSchema.agr) to include the new actions. This ensures that the agent can parse user commands related to the new actions.

### 3. Implement the Action Logic

- Add the implementation for the new actions in [actionHandler.ts](./src/actionHandler.ts). This may involve invoking methods from the .NET component via the [connector.ts](./src/connector.ts) file.

### 4. Update the Manifest

- Add the new actions to [manifest.json](./src/manifest.json), including their descriptions and schema details.

### 5. Test Your Changes

- Write unit tests for the new actions and their handlers.
- Run the tests to ensure that the new functionality works as expected and does not introduce regressions.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter desktop-automation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
