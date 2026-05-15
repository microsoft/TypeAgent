<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=71d84bd3f1b2b8ef478c1a8264fb6adeacf882372f5a24fd4f1d81eb33b5ef43 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# windowsclock-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `windowsclock-agent` package is a TypeAgent application agent designed to interact with the Windows Alarms & Clock app. It enables automation of tasks such as setting alarms, starting timers, running the stopwatch, and adding world clocks.

## What it does

The `windowsclock-agent` package provides a set of actions that can be used to control various features of the Windows Alarms & Clock app. These actions include:

- `addWorldClock`: Add a new world clock by searching for a city and selecting it from suggestions.
- `createAlarm`: Create a new alarm with a specified name and time.
- `navigateToAlarmTab`, `navigateToFocusTab`, `navigateToStopwatchTab`, `navigateToTimerTab`, `navigateToWorldClockTab`: Navigate to different tabs within the app.
- `recordLap`: Record a lap in the stopwatch.
- `renameTimer`: Rename an existing timer.
- `setAlarmEnabled`: Enable or disable an alarm.
- `setFocusSessionRunning`: Start or stop a focus session.
- `setStopwatchRunning`: Start or stop the stopwatch.
- `setTimerViewMode`: Change the view mode of the timer.
- `startTimer`: Start a timer.

These actions are defined in the schema file [windowsClockSchema.ts](./src/windowsClockSchema.ts) and are intended to be implemented in the handler file [windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts).

## Setup

To set up the `windowsclock-agent` package, follow these steps:

1. Ensure you have the necessary dependencies installed by running `pnpm install`.
2. Obtain any required environment variables or API keys as specified in the hand-written README.
3. Follow any additional setup instructions provided in the hand-written README.

## Key Files
The `windowsclock-agent` package is structured as follows:

- **Manifest**: The manifest file [windowsClockManifest.json](./src/windowsClockManifest.json) describes the agent, including its emoji representation and schema details.
- **Schema**: The schema file [windowsClockSchema.ts](./src/windowsClockSchema.ts) defines the types of actions that the agent can perform.
- **Handler**: The handler file [windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts) is where the logic for executing the defined actions will be implemented.

The agent uses the `@typeagent/agent-sdk` for common agent functionalities and the `onboarding-agent` for UI automation playback.

## How to extend

To extend the `windowsclock-agent` package, follow these steps:

1. Open the schema file [windowsClockSchema.ts](./src/windowsClockSchema.ts) and define any new actions you want to add.
2. Implement the logic for the new actions in the handler file [windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts). Use the provided helper functions and classes from the `@typeagent/agent-sdk` and `onboarding-agent` packages.
3. Test your changes thoroughly to ensure the new actions work as expected. You can run tests using the existing test framework or add new tests as needed.

By following these steps, you can extend the functionality of the `windowsclock-agent` package to support additional features or improve existing ones.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/windowsClockManifest.json](./src/windowsClockManifest.json)
- `./agent/handlers` → [./dist/windowsClockActionHandler.js](./dist/windowsClockActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [onboarding-agent](../../../packages/agents/onboarding/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/windowsClockActionHandler.ts`, `./src/windowsClockManifest.json`, `./src/windowsClockSchema.ts`, …and 1 more under `./src/`.

### Agent surface

- Manifest: [./src/windowsClockManifest.json](./src/windowsClockManifest.json)
- Schema: [./src/windowsClockSchema.ts](./src/windowsClockSchema.ts)
- Handler: [./src/windowsClockActionHandler.ts](./src/windowsClockActionHandler.ts)

### Actions

_14 actions declared in the schema, none yet implemented in [`./src/windowsClockActionHandler.ts`]._

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:26.515Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter windowsclock-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
