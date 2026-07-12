<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d437aa762997da2e14ccd35d9ba936ae2d79986efb264766a977d95ca9df1ca8 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# windowsclock-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `windowsclock-agent` is a TypeAgent application agent designed to automate interactions with the Windows Alarms & Clock application. It provides a structured framework for performing tasks such as setting alarms, starting timers, managing the stopwatch, and adding world clocks through UI automation.

This agent is part of the TypeAgent ecosystem and integrates with other components like `@typeagent/agent-sdk` and `onboarding-agent` to enable efficient UI automation and action handling.

## What it does

The `windowsclock-agent` defines a set of actions that allow programmatic control over the Windows Alarms & Clock app. These actions are grouped into functional categories:

- **World Clock Management**:

  - `addWorldClock`: Add a new world clock by searching for a city and selecting it from the suggestions.

- **Alarm Management**:

  - `createAlarm`: Create a new alarm with a specified name and time.
  - `setAlarmEnabled`: Enable or disable an existing alarm.

- **Navigation**:

  - `navigateToAlarmTab`, `navigateToFocusTab`, `navigateToStopwatchTab`, `navigateToTimerTab`, `navigateToWorldClockTab`: Navigate to specific tabs within the app.

- **Stopwatch Management**:

  - `setStopwatchRunning`: Start or stop the stopwatch.
  - `recordLap`: Record a lap in the stopwatch.

- **Timer Management**:

  - `startTimer`: Start a timer.
  - `renameTimer`: Rename an existing timer.
  - `setTimerViewMode`: Change the view mode of the timer.

- **Focus Session Management**:
  - `setFocusSessionRunning`: Start or stop a focus session.

These actions are defined in the schema file [windowsClockSchema.ts](./src/windowsClockSchema.ts). While the schema specifies the structure and parameters of each action, the logic for executing these actions is intended to be implemented in the handler file [windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts).

## Setup

To set up the `windowsclock-agent` package, follow these steps:

1. **Install Dependencies**: Run `pnpm install` in the root of the repository to install all required dependencies.
2. **Environment Variables**: Ensure that any required environment variables are set. Refer to the hand-written README for details on specific variables or configurations.
3. **Build the Project**: Use the `pnpm build` command to compile the TypeScript files into JavaScript.
4. **UI Automation Helper**: The agent relies on the `onboarding-agent` package for UI automation playback. Ensure that the helper binary required for UI automation is built and available. The helper binary can be built using the `buildHelperBinary` function from the `onboarding-agent` package.

## Key Files

The `windowsclock-agent` package is organized into several key files:

- **[windowsClockManifest.json](./src/windowsClockManifest.json)**: This manifest file provides metadata about the agent, including its emoji representation, description, and schema details. It also specifies the schema file and the type of actions the agent supports.

- **[windowsClockSchema.ts](./src/windowsClockSchema.ts)**: This file defines the schema for the agent's actions. Each action is described with its name, parameters, and expected behavior. For example, the `createAlarm` action includes parameters for the alarm name, hour, and minute.

- **[windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts)**: This is the main handler file where the logic for executing actions is implemented. It uses helper functions and classes from the `@typeagent/agent-sdk` and `onboarding-agent` packages to perform UI automation tasks.

- **Helper Binary**: The agent relies on a helper binary for UI automation. The binary is built using the `buildHelperBinary` function from the `onboarding-agent` package and is located in the `data` directory.

- **[tsconfig.json](./src/tsconfig.json)**: This file contains the TypeScript configuration for the package, including compiler options and file inclusion rules.

## How to extend

To extend the functionality of the `windowsclock-agent`, follow these steps:

1. **Define New Actions**:

   - Open the schema file [windowsClockSchema.ts](./src/windowsClockSchema.ts).
   - Add new action types by defining their structure and parameters. For example, if you want to add an action to delete an alarm, define a new type `DeleteAlarmAction` with the necessary parameters.

2. **Implement Action Logic**:

   - Open the handler file [windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts).
   - Implement the logic for the new actions. Use the `@typeagent/agent-sdk` for common agent functionalities and the `onboarding-agent` for UI automation playback. For example, you can use the `executePlayback` function to simulate user interactions with the Windows Alarms & Clock app.

3. **Update the Manifest**:

   - Add the new actions to the manifest file [windowsClockManifest.json](./src/windowsClockManifest.json) under the `schema` section.

4. **Test Your Changes**:

   - Write unit tests for the new actions to ensure they work as expected. Use the existing test framework or add new test cases as needed.
   - Run the tests to verify the functionality of the new actions.

5. **Document the Changes**:
   - Update the hand-written README to include information about the new actions and any additional setup steps or dependencies.

By following these steps, you can add new capabilities to the `windowsclock-agent` package and enhance its functionality for automating interactions with the Windows Alarms & Clock app.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/windowsClockManifest.json](./src/windowsClockManifest.json)
- `./agent/handlers` → `./dist/windowsClockActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [onboarding-agent](../../../packages/agents/onboarding/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/windowsClockActionHandler.ts`, `./src/windowsClockManifest.json`, `./src/windowsClockSchema.ts`, …and 2 more under `./src/`.

### Agent surface

- Manifest: [./src/windowsClockManifest.json](./src/windowsClockManifest.json)
- Schema: [./src/windowsClockSchema.ts](./src/windowsClockSchema.ts)
- Handler: [./src/windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts)

### Actions

_14 actions declared in the schema, none yet implemented in [`./src/windowsClockActionHandler.ts`]._

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-12T08:45:00.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter windowsclock-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
