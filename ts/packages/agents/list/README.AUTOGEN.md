<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=7c66e76fa860df7771beb0801435d7cc4788156ede6bd4870d5e489b7fb5cc18 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# list-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `list-agent` package is a TypeAgent application agent designed to manage lists. It provides functionality to create, modify, and retrieve lists, making it suitable for use cases such as to-do lists, shopping lists, or other item collections.

## What it does

The `list-agent` package supports a range of actions for interacting with lists. These actions include:

- `addItems`: Add one or more items to a specified list. If the list does not exist, it will be created.
- `removeItems`: Remove one or more items from a specified list.
- `createList`: Create a new list with a given name.
- `getList`: Retrieve the contents of a specified list. This is useful for queries like "What's on my grocery list?" or "What are the contents of my to-do list?"
- `clearList`: Remove all items from a specified list.
- `startEditList`: Begin editing a specified list.

These actions are defined in the [listSchema.ts](./src/listSchema.ts) file and implemented in the [listActionHandler.ts](./src/listActionHandler.ts) file. The package also includes grammar definitions in [listSchema.agr](./src/listSchema.agr) to map user utterances to these actions.

## Setup

The `list-agent` package does not require any special setup beyond installing its dependencies. To get started, run:

```sh
pnpm install
```

For additional details, refer to the hand-written README.

## Key Files

The `list-agent` package is organized around several key files that define its functionality:

- **Manifest**: [listManifest.json](./src/listManifest.json) contains metadata about the agent, including its description, emoji representation, and schema details.
- **Schema**: [listSchema.ts](./src/listSchema.ts) defines the actions and their parameters, specifying what the agent can do.
- **Grammar**: [listSchema.agr](./src/listSchema.agr) includes patterns for user input that map to the defined actions.
- **Handler**: [listActionHandler.ts](./src/listActionHandler.ts) implements the logic for executing the actions defined in the schema.

### File Responsibilities

- [listManifest.json](./src/listManifest.json): This file provides metadata about the agent, such as its description and the locations of its schema and grammar files.
- [listSchema.ts](./src/listSchema.ts): This file defines the action types (`addItems`, `removeItems`, etc.) and their parameters. It is the primary reference for understanding the agent's capabilities.
- [listSchema.agr](./src/listSchema.agr): This file contains grammar rules that map user utterances to actions. For example, phrases like "Add milk to my grocery list" are parsed here to trigger the `addItems` action.
- [listActionHandler.ts](./src/listActionHandler.ts): This file implements the logic for handling actions. It processes the input parameters and performs the necessary operations, such as adding items to a list or retrieving list contents.

## How to extend

To extend the `list-agent` package, follow these steps:

1. **Add a new action**:

   - Define the new action type in [listSchema.ts](./src/listSchema.ts).
   - Add corresponding grammar patterns in [listSchema.agr](./src/listSchema.agr).
   - Implement the action's logic in [listActionHandler.ts](./src/listActionHandler.ts).

2. **Modify existing actions**:

   - Update the action type definitions in [listSchema.ts](./src/listSchema.ts).
   - Adjust grammar patterns in [listSchema.agr](./src/listSchema.agr) as needed.
   - Modify the handling logic in [listActionHandler.ts](./src/listActionHandler.ts).

3. **Test your changes**:
   - Add or update tests to cover your changes.
   - Run the tests to ensure that your modifications work as intended.

By following these steps, you can extend the functionality of the `list-agent` package to meet additional requirements or use cases.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/listManifest.json](./src/listManifest.json)
- `./agent/handlers` → `./dist/listActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter list-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
