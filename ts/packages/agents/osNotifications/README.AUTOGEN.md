<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5f595a13ba8475014b35de745d386e175908ac75c5b6e868d26ad2bfbbc3a757 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# os-notifications-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `os-notifications-agent` package integrates operating system notifications from Windows Action Center and Linux freedesktop into the TypeAgent chat system. These notifications are displayed as ephemeral toasts or inline messages, providing real-time updates to users. Notifications are not persisted and are removed from the chat interface when dismissed at the OS level. macOS is not supported.

## What it does

The `os-notifications-agent` captures and processes OS-level notifications and forwards them to connected TypeAgent chat clients. Notifications are ephemeral and are not stored in the `displayLog.json`. The agent supports the following key actions:

- **`syncOsNotifications`**: Re-emits currently-present notifications through the agent pipeline. This action is Windows-only, as Linux's freedesktop specification does not support querying existing notifications. If the required Windows helper executable is not available, the agent will prompt the user to build it.
- **`testOsNotification`**: Generates a synthetic notification and processes it through the agent pipeline. This is useful for testing the agent's functionality without relying on actual OS notifications.

The agent applies several processing steps to notifications before forwarding them:

1. **Application Filtering**: Notifications can be filtered based on an allowlist or blocklist of application names.
2. **Rate Limiting**: A rolling 60-second window limits the number of notifications to prevent spam (default: 20 notifications per minute).
3. **Timestamp Gating**: Only notifications received after the agent is enabled are forwarded.
4. **Dismiss Tracking**: Notifications are removed from the chat interface when dismissed at the OS level.

Notifications are broadcast to all connected clients by default, but future updates may allow routing to specific conversations.

## Setup

To enable and configure the `os-notifications-agent`, follow these steps:

1. **Enable the agent**:
   Run the following command in the TypeAgent chat interface:

   ```shell
   @config agent enable osNotifications
   ```

2. **Windows-specific setup**:

   - The Windows watcher requires a helper executable (`OsNotificationListener.exe`) to subscribe to the `Windows.UI.Notifications.Management.UserNotificationListener` API. This executable must be built, signed, and registered using the WinAppSDK build/sign/register pipeline.
   - If the helper executable is not present, the agent will prompt the user to build it by displaying an in-chat yes/no card. Accepting the prompt will trigger the build process and restart the watcher.

3. **Linux-specific setup**:
   - No additional setup is required on Linux systems. The agent uses the D-Bus interface to monitor notifications.

Refer to the hand-written README for detailed instructions on building and registering the Windows helper executable.

## Key Files

The package is structured around several key files, each responsible for a specific aspect of the agent's functionality:

- **[osNotificationsManifest.json](./src/osNotificationsManifest.json)**: Defines the agent's metadata, including its schema, description, and default settings.
- **[osNotificationsSchema.ts](./src/osNotificationsSchema.ts)**: Specifies the structure of the actions supported by the agent, such as `syncOsNotifications` and `testOsNotification`.
- **[osNotificationsSchema.agr](./src/osNotificationsSchema.agr)**: Contains the natural language grammar for triggering the agent's actions.
- **[osNotificationsActionHandler.ts](./src/osNotificationsActionHandler.ts)**: Implements the logic for handling the agent's actions, including notification filtering, rate limiting, and dismiss tracking.
- **[osNotificationsConfig.ts](./src/osNotificationsConfig.ts)**: Provides user-configurable settings, such as notification display mode, routing, and filtering options.
- **[watcherProtocol.ts](./src/watcherProtocol.ts)**: Defines the shared types and interfaces for communication between the platform-specific watchers and the agent.
- **[watchers/index.ts](./src/watchers/index.ts)**: Serves as the entry point for initializing the appropriate platform-specific watcher.
- **Platform-specific watchers**:
  - **Windows**: [windowsWatcher.ts](./src/watchers/windowsWatcher.ts) — Implements the Windows notification watcher using a .NET helper executable.
  - **Linux**: [linuxWatcher.ts](./src/watchers/linuxWatcher.ts) — Implements the Linux notification watcher using the D-Bus interface.

## How to extend

To extend the `os-notifications-agent`, you can add new actions, modify configurations, or support additional platforms. Here’s how:

1. **Adding a new action**:

   - Define the new action in [osNotificationsSchema.ts](./src/osNotificationsSchema.ts).
   - Update the natural language grammar in [osNotificationsSchema.agr](./src/osNotificationsSchema.agr) to include triggers for the new action.
   - Implement the action's logic in [osNotificationsActionHandler.ts](./src/osNotificationsActionHandler.ts).

2. **Modifying configuration**:

   - Add new configuration options to [osNotificationsConfig.ts](./src/osNotificationsConfig.ts).
   - Ensure the new options are respected in the action handler and watcher logic.

3. **Supporting additional platforms**:

   - Create a new watcher implementation in the `watchers` directory for the target platform.
   - Update [index.ts](./src/watchers/index.ts) to include the new watcher.

4. **Testing**:

   - Write unit tests for the new functionality.
   - Use the `testOsNotification` action to verify the end-to-end behavior of the agent.

5. **Documentation**:
   - Update the schema and grammar files to reflect the new functionality.
   - Document the changes in the hand-written README and ensure the auto-generated documentation reflects the updates.

By following these steps, you can enhance the `os-notifications-agent` to support new actions, configurations, and platforms while maintaining compatibility with the existing system.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/osNotificationsManifest.json](./src/osNotificationsManifest.json)
- `./agent/handlers` → [./dist/osNotificationsActionHandler.js](./dist/osNotificationsActionHandler.js)

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

_Auto-generated against commit `f928ce70269b7d0f8942977c29147b2c8832b722` on `2026-07-15T22:42:29.947Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter os-notifications-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
