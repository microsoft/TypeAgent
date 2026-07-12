<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=17029d8a867b60a65fd88a92f1b90cad981de72b0920dcf297e4f6d041f57666 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# timer-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `timer-agent` is a TypeAgent application agent designed to manage timers and reminders. It enables users to set, list, and cancel reminders, which are delivered as agent-initiated messages. This agent also serves as a test fixture for validating agent-initiated message flows, such as those triggered by `SessionContext.beginAgentThread` and managed through `startBackgroundTasks` and `stopBackgroundTasks`.

The agent supports both one-time and recurring reminders, with customizable display formats such as "bubble," "toast," and "inline." It also ensures that reminders persist across dispatcher restarts by storing them in `sessionStorage`.

## What it does

The `timer-agent` provides the following key functionalities:

- **Set one-time reminders**: The `setReminder` action allows users to schedule a reminder for a specific time. The reminder can be displayed as a bubble (default), toast, or inline message. For example, users can say, "Remind me to call John in 10 minutes as a toast."

- **Set recurring reminders**: The `repeatReminder` action enables users to set reminders that repeat at regular intervals. Users can specify the interval (e.g., "every 5 minutes") and optionally limit the number of repetitions. This action is particularly useful for testing scenarios involving frequent agent-initiated messages.

- **List pending reminders**: The `listReminders` action provides an overview of all currently scheduled reminders, including their details such as message, time, and display format.

- **Cancel reminders**: The `cancelReminder` action allows users to cancel a specific reminder by its ID or cancel all reminders. For example, users can say, "Cancel reminder 123" or "Cancel all reminders."

When a reminder is triggered, the agent sends a message to the user via `SessionContext.beginAgentThread`, creating an agent-initiated thread. This ensures that the reminder is delivered even if there is no active user request.

The agent also supports natural language inputs for setting reminders, such as "remind me to take a break in 10 minutes" or "remind me to call John every hour." It uses a grammar-based approach to parse these inputs and map them to the appropriate actions.

## Setup

The `timer-agent` does not require any external API keys, OAuth credentials, or additional configuration. To get started, follow these steps:

1. Clone the repository and navigate to the `ts/packages/agents/timer/` directory.
2. Install the package dependencies using the following command:
   ```bash
   pnpm install
   ```

For more detailed setup instructions, refer to the hand-written README.

## Key Files

The `timer-agent` package is structured around several key files that define its behavior and functionality:

- **[timerManifest.json](./src/timerManifest.json)**: This file contains metadata about the agent, including its description and the schema it uses. It serves as the entry point for the agent's configuration.

- **[timerSchema.ts](./src/timerSchema.ts)**: This file defines the TypeScript types for the actions supported by the agent. It includes the `setReminder`, `repeatReminder`, `listReminders`, and `cancelReminder` actions, along with their parameters.

- **[timerActionHandler.ts](./src/timerActionHandler.ts)**: This is the core file where the logic for handling the defined actions is implemented. It manages the scheduling, execution, and persistence of reminders. It also handles the rehydration of reminders from `sessionStorage` after a dispatcher restart.

- **[timerSchema.agr](./src/timerSchema.agr)**: This file contains the grammar definitions for parsing natural language inputs into structured actions. It maps user phrases like "remind me to call John in 10 minutes" to the `setReminder` action with the appropriate parameters.

- **sessionStorage/reminders.json**: This file is used to persist pending reminders. It ensures that reminders are not lost during dispatcher restarts and are rehydrated when the session resumes.

## How to extend

To extend the `timer-agent` with new features or actions, follow these steps:

1. **Add new actions**:

   - Define the new action types in [timerSchema.ts](./src/timerSchema.ts). Each action should have a unique `actionName` and a set of parameters.
   - For example, to add a "snoozeReminder" action, define its type and parameters in the schema.

2. **Implement action handlers**:

   - Add the logic for handling the new action in [timerActionHandler.ts](./src/timerActionHandler.ts). Use the existing handlers for `setReminder` and `repeatReminder` as examples.

3. **Update the grammar**:

   - Modify [timerSchema.agr](./src/timerSchema.agr) to include natural language patterns for the new action. This ensures the agent can interpret user inputs and map them to the new action.

4. **Persist state if necessary**:

   - If the new action requires state persistence, update the logic in [timerActionHandler.ts](./src/timerActionHandler.ts) to save and load the relevant data from `sessionStorage`.

5. **Test your changes**:
   - Write unit tests to verify the new action and its handler. Ensure that the action integrates correctly with the agent's existing functionality.

By following these steps, you can enhance the `timer-agent` to support additional use cases or custom requirements.

## Open work / deferred polish

The following areas have been identified for future improvement or additional features:

- **Toast overlay surface**: Create a dedicated toast overlay for `kind: "toast"` reminders, with features like auto-dismiss, click-to-dismiss, and stacking behavior. This would provide a better user experience compared to the current implementation, which uses `chatView.addNotificationMessage`.

- **Inline rendering**: Develop a distinct rendering style for `kind: "inline"` reminders, such as a compact one-liner row that persists in the scroll without bubble chrome.

- **Command-line flags for `kind`**: Introduce a `--kind` flag for direct invocation of reminders with specific display formats, simplifying the process for users who prefer command-line interactions.

- **Enhanced `when` parsing**: Expand the `when` parameter to support more complex inputs, such as "in 1 hour 30 minutes" or "tomorrow at 9am."

- **Interaction policy verification**: Ensure that agent-initiated messages do not disrupt ongoing user interactions, such as `requestChoice` or `popupQuestion`. This requires manual verification.

- **Multi-conversation routing**: Verify that reminders set in one conversation only fire in that conversation. This behavior is expected to work due to `sessionContext` being bound to a single conversation, but it requires testing.

- **Reminder replay testing**: Confirm that reminders replay correctly when a new client connects to a conversation. This includes verifying that the display format (`kind`) is preserved during serialization and deserialization.

These tasks represent opportunities to enhance the `timer-agent` and its integration with other parts of the system.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/timerManifest.json](./src/timerManifest.json)
- `./agent/handlers` → `./dist/timerActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/timerActionHandler.ts`, `./src/timerManifest.json`, `./src/timerSchema.agr`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/timerManifest.json](./src/timerManifest.json)
- Schema: [./src/timerSchema.ts](./src/timerSchema.ts)
- Grammar: [./src/timerSchema.agr](./src/timerSchema.agr)
- Handler: [./src/timerActionHandler.ts](./src/timerActionHandler.ts)

### Actions

_4 actions implemented by this agent, parsed deterministically from `./src/timerSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                            | Action                                                |
| ---------------------------------------------------- | ----------------------------------------------------- |
| _Set a reminder_                                     | `setReminder` → `{ "message": "…", "when": "…" }`     |
| _Set a repeating reminder_                           | `repeatReminder` → `{ "message": "…", "every": "…" }` |
| _List all pending reminders._                        | `listReminders`                                       |
| _Cancel a pending reminder by id, or all reminders._ | `cancelReminder` → `{ "id": "…" }`                    |

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-12T08:45:00.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter timer-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
