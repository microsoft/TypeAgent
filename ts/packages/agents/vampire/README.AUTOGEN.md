<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=c9abe18ec4032a91f4e6a7245a9ba551495cf34130a9832935b13c3574cc1462 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# vampire-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Vampire Agent is a test agent designed to deliberately collide with other agents to exercise the dispatcher's action collision detection subsystem. It is registered in the default agent provider but is disabled by default, ensuring it does not interfere with production sessions unless explicitly enabled.

## What it does

The Vampire Agent's primary purpose is to create collisions with other agents' actions and grammar patterns. This allows developers to evaluate the dispatcher's resolution strategies (`first-match`, `score-rank`, `priority`, `user-clarify`) in a controlled environment. The agent's actions are divided into three categories:

1. **Exact action-name collisions**: These actions have the same names as actions from other agents, causing static and grammar-match collisions. Examples include `play`, `addItems`, `removeItems`, `getList`, and `createCalendarEvent`.
2. **Grammar-pattern collisions**: The agent's grammar rules overlap with those of other agents, causing runtime grammar/cache match collisions. Examples include `play <target>`, `add <items> to my <list> list`, `remove <items> from my <list> list`, and `what is on my <list> list`.
3. **Synonym/semantic actions**: These actions are semantically similar to actions from other agents, causing fuzzy collisions. Examples include `siphon`, `summon`, `consume`, and `revive`.

The Vampire Agent's handler is intentionally trivial, logging the action that fired and returning a benign result. This ensures that the only signal of interest is which agent won the resolution.

## Setup

To enable the Vampire Agent in a session, update the session settings to include the vampire schema and actions, and configure collision detection:

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

Alternatively, a user-facing `@config agent vampire` CLI command can be used once a session is loaded.

## Key Files

- **[vampireManifest.json](./src/vampireManifest.json)**: Defines the agent's manifest, including its description, schema, and default settings.
- **[vampireSchema.ts](./src/vampireSchema.ts)**: Declares the types for the Vampire Agent's actions, including exact-name collisions and synonym/semantic-similarity actions.
- **[vampireActionHandler.ts](./src/vampireActionHandler.ts)**: Implements the agent's action handler, logging the action that fired and returning a text result.
- **[vampireSchema.agr](./src/vampireSchema.agr)**: Defines the grammar rules that deliberately overlap with other agents' grammar files to exercise runtime grammar/cache match collision detection.

## How to extend

To extend the Vampire Agent, follow these steps:

1. **Add new actions**: Update [vampireSchema.ts](./src/vampireSchema.ts) to include new action types. Ensure they collide with existing actions from other agents.
2. **Update grammar rules**: Modify [vampireSchema.agr](./src/vampireSchema.agr) to include new grammar patterns that overlap with other agents' grammar files.
3. **Modify the action handler**: Update [vampireActionHandler.ts](./src/vampireActionHandler.ts) to handle new actions. Ensure the handler remains trivial, logging the action and returning a benign result.
4. **Test the changes**: Enable the Vampire Agent in a session and configure collision detection. Issue requests that trigger the new actions and observe the dispatcher's resolution strategies.

By following these steps, contributors can extend the Vampire Agent to cover additional collision scenarios and further exercise the dispatcher's action collision detection subsystem.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/vampireManifest.json](./src/vampireManifest.json)
- `./agent/handlers` → [./dist/vampireActionHandler.js](./dist/vampireActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter vampire-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
