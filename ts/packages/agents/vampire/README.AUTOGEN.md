<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=45f507f57a78794966bac201d85bc85338354f927bf6e7aeb8478c8f13e80e45 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vampire-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Vampire Agent is a test agent designed to deliberately collide with other agents' actions and grammar patterns. Its primary purpose is to exercise the dispatcher's action collision detection subsystem in a controlled environment. This agent is not bundled by default and must be explicitly enabled for testing scenarios. It provides a way to evaluate the dispatcher's resolution strategies, such as `first-match`, `score-rank`, `priority`, and `user-clarify`, using real collisions on real input.

## What it does

The Vampire Agent introduces intentional collisions with other agents' actions and grammar patterns to test the dispatcher's behavior under various scenarios. These collisions are categorized into three types:

1. **Exact action-name collisions**:

   - The Vampire Agent defines actions with the same names as those in other agents, such as `play`, `addItems`, `removeItems`, `getList`, and `createCalendarEvent`.
   - These collisions occur at both the static and grammar-match levels, ensuring that the dispatcher must resolve conflicts between identical action names.

2. **Grammar-pattern collisions**:

   - The agent's grammar rules overlap with those of other agents, creating runtime grammar/cache match collisions.
   - Examples include:
     - `play <target>` (collides with `player.play`).
     - `add <items> to my <list> list` (collides with `list.addItems`).
     - `remove <items> from my <list> list` (collides with `list.removeItems`).
     - `what is on my <list> list` (collides with `list.getList`).

3. **Synonym/semantic actions**:
   - The Vampire Agent defines actions that are semantically similar to those in other agents, causing fuzzy collisions.
   - Examples include:
     - `siphon` (synonym for `list.removeItems`).
     - `summon` (synonym for `list.createList`).
     - `consume` (synonym for `list.clearList`).
     - `revive` (synonym for `player.play`).

The agent's action handler is intentionally simple, logging the action that fired and returning a benign result. This ensures that the focus remains on observing the dispatcher's resolution behavior rather than the action's outcome.

## Setup

The Vampire Agent is disabled by default and must be explicitly enabled for testing. To enable it:

1. Install the agent from the workspace catalog source:

   ```text
   @package source list
   @package install vampire
   ```

2. Update the session settings to include the Vampire Agent's schema and actions, and configure collision detection:

   ```ts
   session.updateSettings({
     schemas: { vampire: true },
     actions: { vampire: true },
     collision: {
       static: { detect: true, strategy: "warn" },
       grammarMatch: { detect: true, strategy: "user-clarify" },
       telemetry: { emit: true, debugLog: true },
     },
   });
   ```

3. Alternatively, use the `@config agent vampire` CLI command to enable the agent in a session.

For detailed instructions on enabling collision detection and configuring resolution strategies, refer to the hand-written README.

## Key Files

The Vampire Agent's implementation is organized into the following key files:

- **[vampireManifest.json](./src/vampireManifest.json)**:

  - Defines the agent's manifest, including its description, schema, and default settings.
  - Specifies that the agent is disabled by default.

- **[vampireSchema.ts](./src/vampireSchema.ts)**:

  - Declares the types for the Vampire Agent's actions.
  - Includes exact-name collisions (e.g., `play`, `addItems`) and synonym/semantic-similarity actions (e.g., `siphon`, `summon`).

- **[vampireActionHandler.ts](./src/vampireActionHandler.ts)**:

  - Implements the agent's action handler.
  - Logs the action that fired and returns a text result.
  - The handler is intentionally trivial to ensure the focus remains on collision detection.

- **[vampireSchema.agr](./src/vampireSchema.agr)**:
  - Defines grammar rules that deliberately overlap with other agents' grammar files.
  - Used to exercise runtime grammar/cache match collision detection.

## How to extend

To extend the Vampire Agent, follow these steps:

1. **Add new actions**:

   - Update [vampireSchema.ts](./src/vampireSchema.ts) to define new action types.
   - Ensure the new actions are designed to collide with existing actions from other agents.

2. **Update grammar rules**:

   - Modify [vampireSchema.agr](./src/vampireSchema.agr) to include new grammar patterns that overlap with other agents' grammar files.

3. **Modify the action handler**:

   - Update [vampireActionHandler.ts](./src/vampireActionHandler.ts) to handle the new actions.
   - Ensure the handler remains trivial, logging the action and returning a benign result.

4. **Test the changes**:
   - Enable the Vampire Agent in a session and configure collision detection.
   - Issue requests that trigger the new actions and observe the dispatcher's resolution strategies.

By following these steps, contributors can expand the Vampire Agent's capabilities to cover additional collision scenarios, enabling more comprehensive testing of the dispatcher's action collision detection subsystem.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/vampireManifest.json](./src/vampireManifest.json)
- `./agent/handlers` → `./dist/vampireActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Files of interest

`./src/vampireActionHandler.ts`, `./src/vampireManifest.json`, `./src/vampireSchema.agr`, …and 2 more under `./src/`.

### Agent surface

- Manifest: [./src/vampireManifest.json](./src/vampireManifest.json)
- Schema: [./src/vampireSchema.ts](./src/vampireSchema.ts)
- Grammar: [./src/vampireSchema.agr](./src/vampireSchema.agr)
- Handler: [./src/vampireActionHandler.ts](./src/vampireActionHandler.ts)

### Actions

_9 actions declared in the schema, none yet implemented in [`./src/vampireActionHandler.ts`]._

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vampire-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
