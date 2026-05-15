<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=bd9bd170987b82b536ece83cf127c0f6d5211c6e1ea71702a9f02d05b6189dd5 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# os-notifications-agent â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The `os-notifications-agent` package forwards OS-level notifications from Windows Action Center and Linux freedesktop into TypeAgent chat as ephemeral toasts or inline messages. macOS is not supported. This agent is off by default and must be explicitly enabled.

## What it does

The `os-notifications-agent` package captures notifications from the operating system and forwards them to TypeAgent chat clients. It supports two main actions: `syncOsNotifications` and `testOsNotification`. The `syncOsNotifications` action re-emits currently-present notifications through the agent pipeline, while the `testOsNotification` action injects a synthetic notification for testing purposes. Notifications are broadcast to all connected clients and are displayed as ephemeral toasts or inline messages. The agent also tracks dismiss events to remove notifications from the chat interface when they are dismissed at the OS level.

## Setup

To enable the `os-notifications-agent`, you need to configure the agent explicitly:

```shell
@config agent enable osNotifications
```

For Windows, additional setup is required to build and register the helper executable that subscribes to `Windows.UI.Notifications.Management.UserNotificationListener`. This involves running the WinAppSDK build/sign/register pipeline. On Linux, no extra setup is needed beyond enabling the agent.

See the hand-written README for the full step-by-step setup instructions.

## Key Files
The package is structured as follows:

- **Manifest**: [osNotificationsManifest.json](./src/osNotificationsManifest.json) â€” Defines the agent's metadata and schema.
- **Schema**: [osNotificationsSchema.ts](./src/osNotificationsSchema.ts) â€” Describes the actions supported by the agent.
- **Grammar**: [osNotificationsSchema.agr](./src/osNotificationsSchema.agr) â€” Defines the natural language entry points for the actions.
- **Handler**: [osNotificationsActionHandler.ts](./src/osNotificationsActionHandler.ts) â€” Implements the logic for handling actions.
- **Configuration**: [osNotificationsConfig.ts](./src/osNotificationsConfig.ts) â€” Contains user-tunable settings for the agent.
- **Watcher Protocol**: [watcherProtocol.ts](./src/watcherProtocol.ts) â€” Defines the types shared between the per-platform watchers and the agent.
- **Watchers**: [index.ts](./src/watchers/index.ts) â€” Entry point for starting the appropriate watcher based on the platform.

## How to extend

To extend the `os-notifications-agent`, follow these steps:

1. **Add a new action**:

   - Define the action in [osNotificationsSchema.ts](./src/osNotificationsSchema.ts).
   - Update the grammar in [osNotificationsSchema.agr](./src/osNotificationsSchema.agr) to include natural language triggers for the new action.
   - Implement the action handler logic in [osNotificationsActionHandler.ts](./src/osNotificationsActionHandler.ts).

2. **Modify configuration**:

   - Update [osNotificationsConfig.ts](./src/osNotificationsConfig.ts) to add new configuration options.
   - Ensure the new configuration options are respected in the action handler.

3. **Platform-specific watcher**:

   - Implement a new watcher in the `watchers` directory if supporting a new platform.
   - Update [index.ts](./src/watchers/index.ts) to include the new watcher.

4. **Testing**:
   - Write unit tests for the new action and watcher.
   - Run the tests to ensure the new functionality works as expected.

By following these steps, you can extend the functionality of the `os-notifications-agent` to support additional actions, configurations, and platforms.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` â†’ [./src/osNotificationsManifest.json](./src/osNotificationsManifest.json)
- `./agent/handlers` â†’ [./dist/osNotificationsActionHandler.js](./dist/osNotificationsActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: `dbus-next`, `debug`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/osNotificationsActionHandler.ts`, `./src/osNotificationsManifest.json`, `./src/osNotificationsSchema.agr`, â€¦and 8 more under `./src/`.

### Agent surface

- Manifest: [./src/osNotificationsManifest.json](./src/osNotificationsManifest.json)
- Schema: [./src/osNotificationsSchema.ts](./src/osNotificationsSchema.ts)
- Grammar: [./src/osNotificationsSchema.agr](./src/osNotificationsSchema.agr)
- Handler: [./src/osNotificationsActionHandler.ts](./src/osNotificationsActionHandler.ts)

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.903Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter os-notifications-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
