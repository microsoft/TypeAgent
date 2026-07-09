<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8432e93ee838fda5599ff48341017c3434cec24f35377e2c6760d744040929b8 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# os-notifications-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `os-notifications-agent` package integrates OS-level notifications from Windows Action Center and Linux freedesktop into the TypeAgent chat system. These notifications are displayed as ephemeral toasts or inline messages, providing users with real-time updates from their operating system directly within the chat interface. Note that macOS is not supported. The agent is disabled by default and must be explicitly enabled.

## What it does

The `os-notifications-agent` listens for system notifications and forwards them to connected TypeAgent chat clients. Notifications are displayed as ephemeral messages, meaning they are not stored in the `displayLog.json` and are removed when dismissed at the OS level. The agent supports the following key features:

- **Notification Forwarding**: Captures notifications from the OS and broadcasts them to all connected chat clients. Notifications can be displayed as toasts, inline messages, or informational entries.
- **Dismiss Tracking**: Removes notifications from the chat interface when they are dismissed at the OS level.
- **Rate Limiting**: Limits the number of notifications forwarded to the chat interface to avoid spamming users.
- **Application Filtering**: Allows users to configure an allowlist or blocklist of applications whose notifications should be forwarded.
- **Diagnostic Actions**: Provides two diagnostic actions:
  - `syncOsNotifications`: Re-emits currently-present notifications through the agent pipeline. This action is supported only on Windows.
  - `testOsNotification`: Injects a synthetic notification into the pipeline for testing purposes.

The agent uses `sessionContext.notify(...)` without the `persist` flag, ensuring that notifications are not stored in the display log. Instead, they are ephemeral and tied to the lifecycle of the OS notification.

## Setup

To use the `os-notifications-agent`, follow these steps:

1. **Enable the Agent**:
   The agent is disabled by default. Enable it using the following command:

   ```shell
   @config agent enable osNotifications
   ```

2. **Windows-Specific Setup**:

   - The Windows watcher requires a helper executable (`OsNotificationListener.exe`) to subscribe to the `Windows.UI.Notifications.Management.UserNotificationListener` API. This executable must be built, signed, and registered.
   - If the helper executable is not present, the agent will prompt you to build it. Use the following command to initiate the setup process:
     ```shell
     @config agent setup osNotifications
     ```
   - Follow the on-screen prompts to complete the build and registration process.

3. **Linux-Specific Setup**:
   - On Linux, the agent uses the freedesktop D-Bus notification specification. No additional setup is required beyond enabling the agent.

For detailed setup instructions, refer to the hand-written README.

## Key Files

The `os-notifications-agent` package is organized into the following key files:

- **[osNotificationsManifest.json](./src/osNotificationsManifest.json)**: Defines the agent's metadata, including its schema and default settings.
- **[osNotificationsSchema.ts](./src/osNotificationsSchema.ts)**: Specifies the actions supported by the agent, such as `syncOsNotifications` and `testOsNotification`.
- **[osNotificationsSchema.agr](./src/osNotificationsSchema.agr)**: Contains the natural language grammar for triggering the agent's actions.
- **[osNotificationsActionHandler.ts](./src/osNotificationsActionHandler.ts)**: Implements the logic for handling the agent's actions, including notification forwarding and diagnostic operations.
- **[osNotificationsConfig.ts](./src/osNotificationsConfig.ts)**: Provides user-configurable settings, such as notification display mode, rate limits, and application filters.
- **[watcherProtocol.ts](./src/watcherProtocol.ts)**: Defines the data structures and protocols used by the platform-specific watchers to communicate with the agent.
- **[watchers/index.ts](./src/watchers/index.ts)**: Serves as the entry point for initializing the appropriate watcher based on the operating system.

## How to extend

To extend the functionality of the `os-notifications-agent`, follow these steps:

1. **Add a New Action**:

   - Define the new action in [osNotificationsSchema.ts](./src/osNotificationsSchema.ts).
   - Update the natural language grammar in [osNotificationsSchema.agr](./src/osNotificationsSchema.agr) to include triggers for the new action.
   - Implement the action's logic in [osNotificationsActionHandler.ts](./src/osNotificationsActionHandler.ts).

2. **Modify Configuration**:

   - Add new configuration options in [osNotificationsConfig.ts](./src/osNotificationsConfig.ts).
   - Ensure the new options are respected in the action handler and watcher logic.

3. **Support Additional Platforms**:

   - Implement a new watcher in the `watchers` directory for the new platform.
   - Update [index.ts](./src/watchers/index.ts) to include the new watcher.

4. **Testing**:

   - Write unit tests for the new action and any modified or new watchers.
   - Use the `testOsNotification` action to verify the end-to-end functionality of the agent.

5. **Documentation**:
   - Update the hand-written README and this auto-generated documentation to reflect the new features or changes.

By following these guidelines, you can enhance the `os-notifications-agent` to support additional actions, configurations, or platforms while maintaining consistency with the existing architecture.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/osNotificationsManifest.json](./src/osNotificationsManifest.json)
- `./agent/handlers` → `./dist/osNotificationsActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: `dbus-next`, `debug`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/osNotificationsActionHandler.ts`, `./src/osNotificationsManifest.json`, `./src/osNotificationsSchema.agr`, …and 9 more under `./src/`.

### Agent surface

- Manifest: [./src/osNotificationsManifest.json](./src/osNotificationsManifest.json)
- Schema: [./src/osNotificationsSchema.ts](./src/osNotificationsSchema.ts)
- Grammar: [./src/osNotificationsSchema.agr](./src/osNotificationsSchema.agr)
- Handler: [./src/osNotificationsActionHandler.ts](./src/osNotificationsActionHandler.ts)

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter os-notifications-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
