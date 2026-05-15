<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=21cbfec6da1f18f42b18ef9ddeb0e021537181efe39653ae74ec930078a8fbcf -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# timer-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `timer-agent` package is a TypeAgent application agent designed to manage timers and reminders. It allows users to set, list, and cancel reminders, which fire as agent-initiated messages. This agent is particularly useful for testing agent-initiated message paths and ensuring that reminders are delivered to users without a preceding user request.

## What it does

The `timer-agent` package provides four main actions:

- `setReminder`: Sets a one-time reminder that fires at a specified time. The reminder can be displayed as a bubble, toast, or inline message.
- `repeatReminder`: Sets a repeating reminder that fires at regular intervals. This action is useful for stress testing rapid-fire agent-initiated messages.
- `listReminders`: Lists all pending reminders.
- `cancelReminder`: Cancels a specific reminder by ID or cancels all reminders.

When a reminder fires, the agent pushes a message to the user via `SessionContext.beginAgentThread`, creating an agent-initiated thread. Reminders can be displayed in different formats depending on the specified `kind`.

## Setup

To set up the `timer-agent`, ensure you have the necessary environment configured. The package does not require any external API keys or OAuth setup. Simply install the dependencies using `pnpm install`. For detailed setup instructions, refer to the hand-written README.

## Key Files

The `timer-agent` package is structured as follows:

- [timerManifest.json](./src/timerManifest.json): Defines the agent's manifest, including its description and schema.
- [timerSchema.ts](./src/timerSchema.ts): Contains the TypeScript definitions for the actions supported by the agent.
- [timerActionHandler.ts](./src/timerActionHandler.ts): Implements the logic for handling the actions defined in the schema.
- [timerSchema.agr](./src/timerSchema.agr): Defines the grammar for parsing natural language inputs into actions.

The agent's state, including pending reminders, is persisted to `sessionStorage` to ensure reminders survive dispatcher restarts. A reminder whose fire time has passed during downtime fires on the next tick after rehydration.

## How to extend

To extend the `timer-agent`, follow these steps:

1. **Add new actions**: Define new actions in [timerSchema.ts](./src/timerSchema.ts). Ensure each action has a corresponding handler in [timerActionHandler.ts](./src/timerActionHandler.ts).
2. **Update the grammar**: Modify [timerSchema.agr](./src/timerSchema.agr) to include patterns for the new actions. This ensures the agent can parse natural language inputs correctly.
3. **Persist state**: If your new actions require state persistence, update the logic in [timerActionHandler.ts](./src/timerActionHandler.ts) to save and load state from `sessionStorage`.
4. **Test your changes**: Write tests to verify the new actions and their handlers. Ensure reminders are set, fired, and cancelled correctly.

By following these steps, you can extend the functionality of the `timer-agent` to meet your specific requirements. For detailed instructions and examples, refer to the hand-written README.

## Open work / deferred polish

These tasks were intentionally deferred while standing up the agent-initiated message path end to end. Track and pick up as needed:

### Shell

- **Real toast overlay surface**: `kind: "toast"` currently routes through `chatView.addNotificationMessage` (`appendMode: "temporary"` — gets overwritten by the next message). A fixed-position overlay outside `messageDiv` with auto-dismiss, click-to-dismiss, and stacking would give toast its own visual lane separate from the chat scroll. Wire-up in [main.ts setDisplay/appendDisplay](../../shell/src/renderer/src/main.ts).
- **Distinct inline rendering**: `kind: "inline"` currently shares the same temporary-status path as `kind: "toast"`. A compact non-overwriting one-liner row (similar to the `notification-system-*` join/leave rows auto-created in [chatView.ts](../../shell/src/renderer/src/chat/chatView.ts)) would let inline persist in the scroll without bubble chrome.
- **Auto-scroll / focus / TTS policy**: Agent-initiated messages currently use the same scroll + TTS behavior as response bubbles. Conservative default per the plan: don't auto-speak, don't steal scroll if the user has scrolled up, flash a "new message below" affordance.

### CLI

- **Readline-aware prompt safety**: When no spinner is active and the user is mid-typing at the prompt, `displayContent` writes to stdout and corrupts the readline input line. Needs save-cursor / clear-line / write / restore-cursor handling. Same issue exists today for the `notify` path's non-spinner branch — fix both together. Code path: [enhancedConsole.ts renderAgentMessage](../../cli/src/enhancedConsole.ts).

### Timer agent (this package)

- **`--kind` flag / direct invocation**: Today `kind` is reachable via the anchored grammar patterns ("as a toast", "toast me", "flash"). A command-style flag (`@timer set in 5s "hello" --kind toast`) would match the verbatim test recipe in the plan and avoid the grammar gymnastics.
- **Richer `when` parsing**: Accept "in 1 hour 30 minutes", "tomorrow at 9am", relative phrases. Currently single-unit only.

### Cross-cutting

- **Pending-interaction policy verification**: Confirm that an agent-initiated message arriving during `requestChoice` / `popupQuestion` / `requestInteraction` renders above the prompt without breaking the interaction. Per the plan: bubble appears in chat, prompt remains interactive. No code change expected — pure manual verification.
- **Multi-conversation routing verification**: With two clients on different conversations, a reminder set in conversation A must fire only in A. `sessionContext` is bound to a single conversation by `clientIO` injection so this should already work — needs a verification test, no code change expected.
- **Persistent reminder replay round-trip test**: A bubble reminder that fires during conversation X should re-render in its original slot when a fresh client connects to X. The infrastructure is in place (logged via `setDisplay`, replayed via `replayDisplayHistory`, kind survives serialization) — needs a manual end-to-end test.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/timerManifest.json](./src/timerManifest.json)
- `./agent/handlers` → [./dist/timerActionHandler.js](./dist/timerActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter timer-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
