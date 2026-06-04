<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=723c7326dc4ac226af0036912412b48254f91e425af0db5d4b5a3b18c9ef598a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# list-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `list-agent` package is a TypeAgent application agent designed to manage lists. It provides actions to create, modify, and retrieve lists, making it useful for applications that require list management functionality, such as to-do lists, shopping lists, or any other type of item collection.

## What it does

The `list-agent` package offers a set of actions that allow users to interact with lists. These actions include:

- `addItems`: Adds one or more items to a specified list. If the list does not exist, it is created.
- `removeItems`: Removes one or more items from a specified list.
- `createList`: Creates a new list with the given name.
- `getList`: Retrieves the contents of a specified list, useful for queries like "What's on my grocery list?".
- `clearList`: Clears all items from a specified list.
- `startEditList`: Initiates the editing of a specified list.

These actions are defined in the [listSchema.ts](./src/listSchema.ts) file and are handled by the [listActionHandler.ts](./src/listActionHandler.ts) file.

## Setup

The `list-agent` package does not require any special setup beyond installing dependencies. Ensure you have the necessary packages installed by running:

```sh
pnpm install
```

For detailed setup instructions, refer to the hand-written README.

## Key Files

The `list-agent` package is structured around several key files:

- **Manifest**: [listManifest.json](./src/listManifest.json) describes the agent, including its emoji representation and schema details.
- **Schema**: [listSchema.ts](./src/listSchema.ts) defines the types and actions supported by the agent.
- **Grammar**: [listSchema.agr](./src/listSchema.agr) contains patterns for user requests that map to actions.
- **Handler**: [listActionHandler.ts](./src/listActionHandler.ts) implements the logic for executing actions.

### Key Files and Their Responsibilities

- [listManifest.json](./src/listManifest.json): Contains metadata about the agent, including its description and the schema file locations.
- [listSchema.ts](./src/listSchema.ts): Defines the action types and their parameters. This file is crucial for understanding what actions the agent can perform.
- [listSchema.agr](./src/listSchema.agr): Contains the grammar rules that map user utterances to actions. This file helps in parsing and understanding user requests.
- [listActionHandler.ts](./src/listActionHandler.ts): Implements the logic for handling the actions defined in the schema. This file is where the actual functionality of each action is coded.

## How to extend

To extend the `list-agent` package, follow these steps:

1. **Add a new action**:

   - Define the new action type in [listSchema.ts](./src/listSchema.ts).
   - Add corresponding grammar patterns in [listSchema.agr](./src/listSchema.agr).
   - Implement the action handling logic in [listActionHandler.ts](./src/listActionHandler.ts).

2. **Modify existing actions**:

   - Update the action type definitions in [listSchema.ts](./src/listSchema.ts).
   - Adjust grammar patterns in [listSchema.agr](./src/listSchema.agr) as needed.
   - Modify the handling logic in [listActionHandler.ts](./src/listActionHandler.ts).

3. **Test your changes**:
   - Ensure that your changes are covered by tests. Add or update tests in the appropriate test files.
   - Run the tests to verify that your changes work as expected.

By following these steps, you can extend the functionality of the `list-agent` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/listManifest.json](./src/listManifest.json)
- `./agent/handlers` → [./dist/listActionHandler.js](./dist/listActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/listActionHandler.ts`, `./src/listManifest.json`, `./src/listSchema.agr`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/listManifest.json](./src/listManifest.json)
- Schema: [./src/listSchema.ts](./src/listSchema.ts)
- Grammar: [./src/listSchema.agr](./src/listSchema.agr)
- Handler: [./src/listActionHandler.ts](./src/listActionHandler.ts)

### Actions

_6 actions implemented by this agent, parsed deterministically from `./src/listSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                                                                                                                     | Action                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| _add one or more items to a list; if the list does not exist, create it_                                                                      | `addItems` → `{ "items": ["…"], "listName": "…" }`    |
| _remove one or more items from a list_                                                                                                        | `removeItems` → `{ "items": ["…"], "listName": "…" }` |
| _(no sample)_                                                                                                                                 | `createList` → `{ "listName": "…" }`                  |
| _use this action to show the user what's on the list, for example, "What's on my grocery list?" or "what are the contents of my to do list?"_ | `getList` → `{ "listName": "…" }`                     |
| _(no sample)_                                                                                                                                 | `clearList` → `{ "listName": "…" }`                   |
| _(no sample)_                                                                                                                                 | `startEditList` → `{ "listName": "…" }`               |

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.509Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter list-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
