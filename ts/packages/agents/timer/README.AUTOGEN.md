<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a44ac776fe0364f2ba99c9a80838657a87a796d5d881552343c7a20e20576477 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# timer-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `timer-agent` package is a TypeAgent application agent designed to manage timers and reminders. It enables users to set, list, and cancel reminders, which are delivered as agent-initiated messages. This agent is also used as a test fixture for validating agent-initiated message flows, such as those triggered by `SessionContext.beginAgentThread` and managed through `startBackgroundTasks` and `stopBackgroundTasks`.

## What it does

The `timer-agent` provides functionality for managing reminders and timers through four primary actions:

- **`setReminder`**: Allows users to set a one-time reminder that fires at a specific time. The reminder can be displayed in one of three formats: bubble (default), toast, or inline.
- **`repeatReminder`**: Sets a recurring reminder that fires at regular intervals. This action supports optional parameters like the number of repetitions (`count`) and the display format (`kind`). It is particularly useful for testing scenarios involving frequent agent-initiated messages.
- **`listReminders`**: Lists all currently pending reminders, providing an overview of scheduled tasks.
- **`cancelReminder`**: Cancels a specific reminder by its ID or cancels all reminders.

When a reminder is triggered, the agent sends a message to the user via `SessionContext.beginAgentThread`. This creates an agent-initiated thread, which is not tied to any prior user request. The agent also supports natural language inputs for setting reminders, such as "remind me to take a break in 10 minutes" or "remind me to call John every hour."

The agent persists pending reminders in `sessionStorage`, ensuring that reminders are not lost during dispatcher restarts. If a reminder's scheduled time has passed during downtime, it will fire on the next tick after rehydration.

## Setup

The `timer-agent` does not require any external API keys, OAuth credentials, or additional configuration. To get started, simply install the package dependencies using the following command:

```bash
pnpm install
```

For more detailed setup instructions, refer to the hand-written README.

## Key Files

The `timer-agent` package is organized into several key files that define its functionality:

- **[timerManifest.json](./src/timerManifest.json)**: This file contains the agent's metadata, including its description and the schema it uses.
- **[timerSchema.ts](./src/timerSchema.ts)**: Defines the TypeScript types for the actions supported by the agent, such as `setReminder`, `repeatReminder`, `listReminders`, and `cancelReminder`.
- **[timerActionHandler.ts](./src/timerActionHandler.ts)**: Implements the logic for handling the actions defined in the schema. This file is responsible for managing reminders, scheduling their execution, and persisting their state.
- **[timerSchema.agr](./src/timerSchema.agr)**: Contains the grammar definitions for parsing natural language inputs into structured actions. For example, it maps phrases like "remind me to call John in 10 minutes" to the `setReminder` action with appropriate parameters.

The agent also includes logic for persisting reminders to `sessionStorage/reminders.json`. This ensures that reminders are retained across dispatcher restarts and are rehydrated when the session resumes.

## How to extend

To extend the functionality of the `timer-agent`, follow these steps:

1. **Define new actions**:

   - Add new action types to [timerSchema.ts](./src/timerSchema.ts). Each action should include a unique `actionName` and a set of parameters.
   - For example, to add a "snoozeReminder" action, define its type and parameters in the schema.

2. **Implement action handlers**:

   - Add the logic for handling the new action in [timerActionHandler.ts](./src/timerActionHandler.ts). Use the existing handlers for `setReminder` and `repeatReminder` as references.

3. **Update the grammar**:

   - Modify [timerSchema.agr](./src/timerSchema.agr) to include natural language patterns for the new action. This ensures the agent can interpret user inputs and map them to the new action.

4. **Persist state if needed**:

   - If the new action requires state persistence, update the logic in [timerActionHandler.ts](./src/timerActionHandler.ts) to save and load the relevant data from `sessionStorage`.

5. **Test your changes**:
   - Write unit tests to verify the new action and its handler. Ensure that the action integrates correctly with the agent's existing functionality.

By following these steps, you can extend the `timer-agent` to support additional use cases or custom requirements.

## Open work / deferred polish

The following tasks have been identified as areas for improvement or additional features:

### Shell

- **Toast overlay surface**: The `kind: "toast"` reminders currently use `chatView.addNotificationMessage` with `appendMode: "temporary"`, which overwrites the previous message. A dedicated toast overlay with auto-dismiss, click-to-dismiss, and stacking behavior would improve the user experience. This can be implemented in [main.ts setDisplay/appendDisplay](../../shell/src/renderer/src/main.ts).
- **Inline rendering**: The `kind: "inline"` reminders currently share the same temporary path as `kind: "toast"`. A distinct rendering style, such as a compact one-liner row, would allow inline messages to persist in the scroll without bubble chrome.

### CLI

- **Readline prompt safety**: When the user is typing at the prompt, `displayContent` can overwrite the input line. This issue requires handling cursor saving, clearing, and restoring. The same issue exists for the `notify` path's non-spinner branch and should be addressed together. Relevant code: [enhancedConsole.ts renderAgentMessage](../../cli/src/enhancedConsole.ts).

### Timer agent

- **Command-line flags for `kind`**: Currently, the `kind` parameter is only accessible through grammar patterns (e.g., "as a toast"). Adding a command-line flag (e.g., `@timer set in 5s "hello" --kind toast`) would simplify direct invocation.
- **Enhanced `when` parsing**: Expand the `when` parameter to support more complex inputs, such as "in 1 hour 30 minutes" or "tomorrow at 9am." Currently, only single-unit durations or ISO 8601 timestamps are supported.

### Cross-cutting

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

`./src/timerActionHandler.ts`, `./src/timerManifest.json`, `./src/timerSchema.agr`, …and 2 more under `./src/`.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter timer-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
