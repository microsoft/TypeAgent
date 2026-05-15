<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=cd57c692c58cab6e4d92d6f4b8c07f5cdad4384397fac37f28a964fb571441a1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# list-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `list-agent` package is a TypeAgent application agent designed to manage lists. It provides actions to create, modify, and retrieve lists, making it useful for applications that require list management functionality, such as to-do lists, shopping lists, or any other type of item collection.

## What it does

The `list-agent` package offers a set of actions that allow users to interact with lists. These actions include adding items to a list, removing items from a list, creating a new list, retrieving the contents of a list, and clearing a list. The agent ensures that lists are created if they do not exist when items are added, and it supports various list names that are stemmed to their singular forms.

## Actions

The `list-agent` package defines five primary actions:

1. **addItems**: Adds one or more items to a specified list. If the list does not exist, it is created.
2. **removeItems**: Removes one or more items from a specified list.
3. **createList**: Creates a new list with the given name.
4. **getList**: Retrieves the contents of a specified list, useful for queries like "What's on my grocery list?".
5. **clearList**: Clears all items from a specified list.

These actions are defined in the [listSchema.ts](./src/listSchema.ts) file and are handled by the [listActionHandler.ts](./src/listActionHandler.ts) file.

## Architecture

The `list-agent` package is structured around several key files:

- **Manifest**: [listManifest.json](./src/listManifest.json) describes the agent, including its emoji representation and schema details.
- **Schema**: [listSchema.ts](./src/listSchema.ts) defines the types and actions supported by the agent.
- **Grammar**: [listSchema.agr](./src/listSchema.agr) contains patterns for user requests that map to actions.
- **Handler**: [listActionHandler.ts](./src/listActionHandler.ts) implements the logic for executing actions.

The agent is instantiated using the `instantiate` function, which sets up the context and action execution logic.

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

_5 actions declared by this agent. Parsed deterministically from `./src/listSchema.ts`; comment formatting is preserved verbatim from source._

#### `addItems`

add one or more items to a list; if the list does not exist, create it

Parameters:

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `items` | `string[]` | yes | — |
| `listName` | `string` | yes | name of the list such as "grocery", "to do", "shopping", "packing", "gift","book","idea","movie","garden task","place to visit" names should be lower case and should be stemmed to the singular form (e.g., "movies" should be "movie") |

#### `removeItems`

remove one or more items from a list

Parameters:

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `items` | `string[]` | yes | — |
| `listName` | `string` | yes | — |

#### `createList`

Parameters:

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `listName` | `string` | yes | — |

#### `getList`

use this action to show the user what's on the list, for example, "What's on my grocery list?" or "what are the contents of my to do list?"

Parameters:

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `listName` | `string` | yes | — |

#### `clearList`

Parameters:

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `listName` | `string` | yes | — |

### Example

_Example snippet pending LLM authoring; will be filled in once the generator is wired to the LLM (see `ts/docs/architecture/doc-autogen.md`)._

---

_Auto-generated against commit `c52ef52d052f7bc93f52d2a76e7866fff8958079` on `2026-05-15T02:05:15.705Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter list-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
