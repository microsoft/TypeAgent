<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d437aa762997da2e14ccd35d9ba936ae2d79986efb264766a977d95ca9df1ca8 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# windowsclock-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `windowsclock-agent` package is a TypeAgent application agent designed to automate interactions with the Windows Alarms & Clock application. It provides a set of actions to control features such as alarms, timers, stopwatches, and world clocks, enabling programmatic management of these functionalities.

## What it does

The `windowsclock-agent` facilitates automation of the Windows Alarms & Clock app by defining and handling a variety of actions. These actions are specified in the schema file [windowsClockSchema.ts](./src/windowsClockSchema.ts) and are intended to be implemented in the handler file [windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts).

Key actions include:

- **Alarm Management**: Actions like `createAlarm` and `setAlarmEnabled` allow you to create new alarms, enable or disable existing ones, and manage alarm settings.
- **Timer Operations**: Actions such as `startTimer`, `renameTimer`, and `setTimerViewMode` enable you to control timers, including starting, renaming, and changing their display modes.
- **Stopwatch Control**: Actions like `setStopwatchRunning` and `recordLap` allow you to start, stop, and interact with the stopwatch feature.
- **World Clock Management**: The `addWorldClock` action lets you add new world clocks by searching for cities and selecting from suggestions.
- **Navigation**: Actions such as `navigateToAlarmTab`, `navigateToTimerTab`, `navigateToStopwatchTab`, `navigateToWorldClockTab`, and `navigateToFocusTab` allow you to switch between different sections of the Windows Alarms & Clock app.
- **Focus Sessions**: The `setFocusSessionRunning` action enables you to start or stop focus sessions.

These actions are designed to be executed programmatically, making the agent a useful tool for automating workflows that involve the Windows Alarms & Clock app.

## Setup

To set up the `windowsclock-agent` package, follow these steps:

1. **Install Dependencies**: Run `pnpm install` in the project root to install all required dependencies.
2. **Environment Variables**: Check the hand-written README for any required environment variables or API keys. Ensure these are set up correctly in your development environment.
3. **Additional Setup**: Follow any other setup instructions provided in the hand-written README, such as configuring external tools or services.

## Key Files

The `windowsclock-agent` package is organized into several key files, each serving a specific purpose:

- **[windowsClockManifest.json](./src/windowsClockManifest.json)**: This manifest file provides metadata about the agent, including its description, emoji representation, and schema details.
- **[windowsClockSchema.ts](./src/windowsClockSchema.ts)**: This file defines the schema for the agent's actions, specifying the structure and parameters for each action.
- **[windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts)**: This is the main handler file where the logic for executing the defined actions is implemented. It uses helper functions and classes from the `@typeagent/agent-sdk` and `onboarding-agent` packages.
- **discoveredActions.json**: This file contains pre-discovered actions that can be used by the agent during execution.

The package also relies on the `@typeagent/agent-sdk` for core agent functionalities and the `onboarding-agent` for UI automation playback.

## How to extend

To add new features or modify existing ones in the `windowsclock-agent`, follow these steps:

1. **Define New Actions**: Open the schema file [windowsClockSchema.ts](./src/windowsClockSchema.ts) and add the definitions for the new actions. Ensure you specify the action name, parameters, and any necessary documentation.
2. **Implement Action Logic**: Navigate to the handler file [windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts) and implement the logic for the new actions. Use the helper functions and utilities provided by the `@typeagent/agent-sdk` and `onboarding-agent` packages to simplify development.
3. **Update the Manifest**: If necessary, update the [windowsClockManifest.json](./src/windowsClockManifest.json) file to include references to the new actions or schema changes.
4. **Test Your Changes**: Write and run tests to ensure the new actions work as expected. Use the existing test framework or add new test cases as needed.

By following these steps, you can extend the `windowsclock-agent` to support additional automation scenarios or enhance its current capabilities.

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

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter windowsclock-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
