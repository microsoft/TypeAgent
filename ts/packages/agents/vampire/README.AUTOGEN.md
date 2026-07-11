<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=45f507f57a78794966bac201d85bc85338354f927bf6e7aeb8478c8f13e80e45 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vampire-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Vampire Agent is a test agent designed to intentionally collide with other agents' actions and grammar patterns. Its purpose is to test and validate the dispatcher's action collision detection subsystem, which resolves conflicts when multiple agents match the same input. The Vampire Agent is disabled by default and is not included in production builds, ensuring it is only used in controlled testing environments.

## What it does

The Vampire Agent is a tool for testing the dispatcher's ability to handle action collisions. It is specifically designed to create controlled conflicts with other agents, enabling developers to evaluate and refine the dispatcher's resolution strategies. These strategies include `first-match`, `score-rank`, `priority`, and `user-clarify`.

The Vampire Agent's actions are grouped into three categories:

1. **Exact action-name collisions**: These actions share the same names as actions from other agents, creating static and grammar-match collisions. Examples include:

   - `play` (collides with `player.play` and `video.play`)
   - `addItems` (collides with `list.addItems`)
   - `removeItems` (collides with `list.removeItems`)
   - `getList` (collides with `list.getList`)
   - `createCalendarEvent` (collides with `calendar.createCalendarEvent`)

2. **Grammar-pattern collisions**: The Vampire Agent's grammar rules overlap with those of other agents, causing runtime grammar/cache match collisions. Examples include:

   - `play <target>` (collides with the `<Play>` rule in the player agent)
   - `add <items> to my <list> list` (collides with `list.<AddItems>`)
   - `remove <items> from my <list> list` (collides with `list.<RemoveItems>`)
   - `what is on my <list> list` (collides with `list.<GetList>`)

3. **Synonym/semantic actions**: These actions are semantically similar to actions from other agents, creating fuzzy collisions. Examples include:
   - `siphon` (similar to `list.removeItems`)
   - `summon` (similar to `list.createList`)
   - `consume` (similar to `list.clearList`)
   - `revive` (similar to `player.play`)

The Vampire Agent's action handler is intentionally simple. It logs the action that was triggered and returns a benign result, allowing developers to focus on observing the dispatcher's behavior during collision resolution.

## Setup

The Vampire Agent is not enabled by default and must be explicitly activated for testing. To enable it, follow these steps:

1. Install the Vampire Agent from the workspace catalog source:

   ```text
   @package source list
   @package install vampire
   ```

2. Update the session settings to enable the Vampire Agent's schema and actions, and configure collision detection:

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

3. Optionally, use the `@config agent vampire` CLI command to enable the agent in a loaded session.

For more details on the setup process, refer to the hand-written README.

## Key Files

- **[vampireManifest.json](./src/vampireManifest.json)**: Defines the agent's metadata, including its description, schema, and default settings. This file specifies that the Vampire Agent is disabled by default.
- **[vampireSchema.ts](./src/vampireSchema.ts)**: Declares the types for the Vampire Agent's actions. This includes actions designed to collide with other agents' actions by name, grammar, or semantic similarity.
- **[vampireActionHandler.ts](./src/vampireActionHandler.ts)**: Implements the agent's action handler. This file contains the logic for logging the triggered action and returning a benign result. It is intentionally kept simple to avoid introducing unintended behavior.
- **[vampireSchema.agr](./src/vampireSchema.agr)**: Defines the grammar rules for the Vampire Agent. These rules deliberately overlap with other agents' grammar files to create runtime grammar/cache match collisions.

## How to extend

To extend the Vampire Agent, follow these steps:

1. **Add new actions**:

   - Update [vampireSchema.ts](./src/vampireSchema.ts) to define new action types. Ensure these actions are designed to collide with existing actions from other agents.
   - For example, you might add a new action `mergeLists` that collides with a similar action in another agent.

2. **Update grammar rules**:

   - Modify [vampireSchema.agr](./src/vampireSchema.agr) to include new grammar patterns that overlap with other agents' grammar files.
   - For example, you could add a rule like `merge <list1> with <list2>` to test grammar-pattern collisions.

3. **Modify the action handler**:

   - Update [vampireActionHandler.ts](./src/vampireActionHandler.ts) to handle the new actions. Ensure the handler remains simple, logging the action and returning a benign result.

4. **Test the changes**:

   - Enable the Vampire Agent in a session and configure collision detection.
   - Issue requests that trigger the new actions and observe the dispatcher's resolution strategies.

5. **Add tests**:
   - Create or update test cases to validate the new actions and grammar rules. For example, you can add integration tests to ensure the new collisions are detected and resolved as expected.

By following these steps, you can expand the Vampire Agent's capabilities to cover additional collision scenarios, providing more comprehensive testing for the dispatcher's collision detection subsystem.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vampire-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
