<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=45f507f57a78794966bac201d85bc85338354f927bf6e7aeb8478c8f13e80e45 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vampire-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Vampire Agent is a specialized test agent designed to create intentional collisions with other agents' actions and grammar patterns. Its primary purpose is to test and validate the dispatcher's action collision detection subsystem, which resolves conflicts when multiple agents match the same input. The Vampire Agent is not included in production builds and must be explicitly enabled for testing purposes.

## What it does

The Vampire Agent is a tool for testing the dispatcher's ability to handle action collisions. It is designed to simulate three types of collisions:

1. **Exact action-name collisions**: The Vampire Agent defines actions with the same names as those in other agents, such as `play`, `addItems`, `removeItems`, `getList`, and `createCalendarEvent`. These collisions test the dispatcher's ability to handle static and grammar-match conflicts.

2. **Grammar-pattern collisions**: The agent's grammar rules overlap with those of other agents, creating runtime grammar/cache match collisions. For example:

   - `play <target>` collides with the `player` agent's `<Play>` rule.
   - `add <items> to my <list> list` collides with the `list` agent's `<AddItems>` rule.
   - `remove <items> from my <list> list` collides with the `list` agent's `<RemoveItems>` rule.
   - `what is on my <list> list` collides with the `list` agent's `<GetList>` rule.

3. **Synonym/semantic actions**: The Vampire Agent includes actions that are semantically similar to those of other agents, such as `siphon` (similar to `list.removeItems`), `summon` (similar to `list.createList`), `consume` (similar to `list.clearList`), and `revive` (similar to `player.play`). These actions are designed to test fuzzy collision detection when a semantic similarity scorer is implemented.

The Vampire Agent's action handler is intentionally simple. It logs the action that was triggered and returns a benign text result. This ensures that the focus remains on observing the dispatcher's behavior during collision resolution.

## Setup

The Vampire Agent is disabled by default and must be explicitly enabled for testing. To set up and use the Vampire Agent:

1. **Install the agent**: Use the workspace catalog source to install the Vampire Agent.

   ```text
   @package source list
   @package install vampire
   ```

2. **Enable the agent in a session**: Update the session settings to include the Vampire Agent's schema and actions, and configure collision detection. For example:

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

   Alternatively, you can use the `@config agent vampire` CLI command to enable the agent in a session.

3. **Run collision tests**: With the Vampire Agent enabled, issue requests that are designed to trigger collisions and observe the dispatcher's behavior under different resolution strategies (`first-match`, `score-rank`, `priority`, `user-clarify`).

## Key Files

- **[vampireManifest.json](./src/vampireManifest.json)**: Contains metadata about the Vampire Agent, including its description, schema, and default settings. The manifest specifies that the agent is disabled by default.
- **[vampireSchema.ts](./src/vampireSchema.ts)**: Defines the types for the Vampire Agent's actions, including those that cause exact-name collisions and synonym/semantic-similarity collisions.
- **[vampireActionHandler.ts](./src/vampireActionHandler.ts)**: Implements the action handler for the Vampire Agent. This handler logs the action that was triggered and returns a benign text result.
- **[vampireSchema.agr](./src/vampireSchema.agr)**: Declares grammar rules that intentionally overlap with other agents' grammar files to create runtime grammar/cache match collisions.

## How to extend

To extend the Vampire Agent and add new collision scenarios, follow these steps:

1. **Define new actions**: Add new action types to [vampireSchema.ts](./src/vampireSchema.ts). Ensure the new actions are designed to collide with existing actions from other agents, either by using the same action names or by creating semantic overlaps.

2. **Add grammar rules**: Update [vampireSchema.agr](./src/vampireSchema.agr) to include new grammar patterns that overlap with other agents' grammar files. This will help test runtime grammar/cache match collisions.

3. **Update the action handler**: Modify [vampireActionHandler.ts](./src/vampireActionHandler.ts) to handle the new actions. The handler should remain simple, logging the action and returning a benign result.

4. **Test the new actions**: Enable the Vampire Agent in a session and configure collision detection. Issue requests that trigger the new actions and observe the dispatcher's behavior under different resolution strategies.

5. **Add tests**: Create or update test cases to validate the new collision scenarios. For example, you can add integration tests to ensure that the dispatcher resolves collisions as expected when the Vampire Agent is enabled.

By following these steps, contributors can expand the Vampire Agent's capabilities and ensure comprehensive testing of the dispatcher's action collision detection subsystem.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-12T08:45:00.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vampire-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
