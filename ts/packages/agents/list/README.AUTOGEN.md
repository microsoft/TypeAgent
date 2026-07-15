<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d34d6ecbd9e1486cbd5703e8f8d924d766d2660ead7ac32e2e391f372e8c7b43 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# list-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `list-agent` package is a TypeAgent application agent designed to manage lists. It provides a set of actions for creating, modifying, and retrieving lists, making it suitable for use cases such as to-do lists, shopping lists, or other item collections. This agent is part of the TypeAgent monorepo and integrates with other components in the system to handle user requests related to list management.

## What it does

The `list-agent` supports a variety of actions to manage lists, enabling users to create, modify, and retrieve lists and their contents. The following actions are implemented:

- **`addItems`**: Adds one or more items to a specified list. If the list does not exist, it is created. Parameters: `items` (array of strings) and `listName` (string).
- **`removeItems`**: Removes one or more items from a specified list. Parameters: `items` (array of strings) and `listName` (string).
- **`createList`**: Creates a new list with the given name. Parameter: `listName` (string).
- **`getList`**: Retrieves the contents of a specified list. Useful for queries like "What's on my grocery list?" or "What are the contents of my to-do list?" Parameter: `listName` (string).
- **`clearList`**: Clears all items from a specified list. Parameter: `listName` (string).
- **`listLists`**: Lists all existing lists. Useful for queries like "What lists do I have?" or "Show me my lists."
- **`startEditList`**: Initiates the editing of a specified list. Parameter: `listName` (string).

These actions are defined in the [listSchema.ts](./src/listSchema.ts) file and implemented in the [listActionHandler.ts](./src/listActionHandler.ts) file. The agent uses schema definitions and grammar rules to interpret user input and map it to the appropriate actions.

## Setup

The `list-agent` package does not require any special setup beyond installing its dependencies. To get started, navigate to the package directory and run:

```sh
pnpm install
```

For additional details, refer to the hand-written README.

## Key Files

The `list-agent` package is structured around several key files that define its behavior and functionality:

- **[listManifest.json](./src/listManifest.json)**: Contains metadata about the agent, such as its description, emoji representation, and references to the schema and grammar files.
- **[listSchema.ts](./src/listSchema.ts)**: Defines the action types and their parameters. This file is the core of the agent's functionality, specifying the actions the agent can perform and the data they require.
- **[listSchema.agr](./src/listSchema.agr)**: Contains grammar rules that map user utterances to actions. These rules help the agent interpret natural language input and determine the appropriate action to execute.
- **[listActionHandler.ts](./src/listActionHandler.ts)**: Implements the logic for handling the actions defined in the schema. This file is where the actual behavior of each action is coded.

### File Responsibilities

- **Manifest**: The [listManifest.json](./src/listManifest.json) file provides a high-level overview of the agent, including its purpose and the files it depends on.
- **Schema**: The [listSchema.ts](./src/listSchema.ts) file defines the structure of the actions and their parameters. For example, the `addItems` action requires an array of items and a list name.
- **Grammar**: The [listSchema.agr](./src/listSchema.agr) file contains patterns for user input, such as "Add milk to my grocery list," and maps them to the corresponding actions.
- **Handler**: The [listActionHandler.ts](./src/listActionHandler.ts) file contains the implementation of the actions. For instance, it defines how to add items to a list or retrieve the contents of a list.

## How to extend

To extend the functionality of the `list-agent` package, follow these steps:

1. **Add a new action**:

   - Define the new action type in [listSchema.ts](./src/listSchema.ts). Specify the action name and its required parameters.
   - Add grammar rules for the new action in [listSchema.agr](./src/listSchema.agr). These rules should map user input to the new action.
   - Implement the action's logic in [listActionHandler.ts](./src/listActionHandler.ts). This is where you define how the action will be executed.

2. **Modify existing actions**:

   - Update the action type definitions in [listSchema.ts](./src/listSchema.ts) to reflect the changes.
   - Adjust the corresponding grammar rules in [listSchema.agr](./src/listSchema.agr) to ensure they align with the updated action.
   - Modify the implementation in [listActionHandler.ts](./src/listActionHandler.ts) to handle the updated behavior.

3. **Test your changes**:
   - Add or update tests to cover the new or modified functionality.
   - Run the test suite to ensure that your changes work as expected and do not introduce regressions.

By following these steps, you can customize the `list-agent` package to support additional use cases or modify its existing behavior to better suit your needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/listManifest.json](./src/listManifest.json)
- `./agent/handlers` → [./dist/listActionHandler.js](./dist/listActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/listActionHandler.ts`, `./src/listManifest.json`, `./src/listSchema.agr`, …and 4 more under `./src/`.

### Agent surface

- Manifest: [./src/listManifest.json](./src/listManifest.json)
- Schema: [./src/listSchema.ts](./src/listSchema.ts)
- Grammar: [./src/listSchema.agr](./src/listSchema.agr)
- Handler: [./src/listActionHandler.ts](./src/listActionHandler.ts)

### Actions

_7 actions implemented by this agent, parsed deterministically from `./src/listSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                                                                                                                     | Action                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| _add one or more items to a list; if the list does not exist, create it_                                                                      | `addItems` → `{ "items": ["…"], "listName": "…" }`    |
| _remove one or more items from a list_                                                                                                        | `removeItems` → `{ "items": ["…"], "listName": "…" }` |
| _(no sample)_                                                                                                                                 | `createList` → `{ "listName": "…" }`                  |
| _use this action to show the user what's on the list, for example, "What's on my grocery list?" or "what are the contents of my to do list?"_ | `getList` → `{ "listName": "…" }`                     |
| _(no sample)_                                                                                                                                 | `clearList` → `{ "listName": "…" }`                   |
| _use this action to show the user which lists exist, for example, "what lists are there?", "show me my lists", "what lists do I have?"_       | `listLists`                                           |
| _(no sample)_                                                                                                                                 | `startEditList` → `{ "listName": "…" }`               |

---

_Auto-generated against commit `f928ce70269b7d0f8942977c29147b2c8832b722` on `2026-07-15T22:42:29.947Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter list-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
