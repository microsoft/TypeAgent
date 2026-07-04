<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=7c66e76fa860df7771beb0801435d7cc4788156ede6bd4870d5e489b7fb5cc18 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# list-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `list-agent` package is a TypeAgent application agent designed to manage lists. It provides a set of actions for creating, modifying, and retrieving lists, making it suitable for use cases such as to-do lists, shopping lists, or other item collections. This agent is part of the TypeAgent monorepo and integrates with other components in the system to handle user requests related to list management.

## What it does

The `list-agent` package supports six actions, each designed to handle a specific aspect of list management:

- **`addItems`**: Adds one or more items to a specified list. If the list does not already exist, it will be created automatically.
- **`removeItems`**: Removes one or more items from a specified list.
- **`createList`**: Creates a new list with a given name.
- **`getList`**: Retrieves the contents of a specified list. This action is useful for answering user queries like "What's on my grocery list?" or "What are the contents of my to-do list?"
- **`clearList`**: Removes all items from a specified list.
- **`startEditList`**: Initiates the editing of a specified list, allowing for further modifications.

These actions are defined in the [listSchema.ts](./src/listSchema.ts) file and are implemented in the [listActionHandler.ts](./src/listActionHandler.ts) file. The agent uses a combination of schema definitions, grammar rules, and handler logic to process user requests and execute the appropriate actions.

## Setup

The `list-agent` package does not require any special setup beyond installing its dependencies. To get started:

1. Ensure you have `pnpm` installed on your system.
2. Run the following command in the root of the monorepo to install all dependencies:

   ```sh
   pnpm install
   ```

For additional setup details, refer to the hand-written README.

## Key Files

The `list-agent` package is organized into several key files that define its functionality and behavior:

- **[listManifest.json](./src/listManifest.json)**: This file contains metadata about the agent, including its description, emoji representation, and references to the schema and grammar files.
- **[listSchema.ts](./src/listSchema.ts)**: This file defines the action types and their parameters. It is the primary source for understanding the actions the agent can perform.
- **[listSchema.agr](./src/listSchema.agr)**: This file contains grammar rules that map user utterances to specific actions. It defines how the agent interprets user input and translates it into actionable commands.
- **[listActionHandler.ts](./src/listActionHandler.ts)**: This file implements the logic for handling the actions defined in the schema. It is the core of the agent's functionality, processing user requests and executing the corresponding actions.

### File Responsibilities

- **Manifest**: The [listManifest.json](./src/listManifest.json) file provides a high-level description of the agent and its capabilities. It also specifies the locations of the schema and grammar files.
- **Schema**: The [listSchema.ts](./src/listSchema.ts) file is where the action types (`addItems`, `removeItems`, etc.) and their parameters are defined. This file is essential for understanding the agent's capabilities and how to extend them.
- **Grammar**: The [listSchema.agr](./src/listSchema.agr) file contains patterns for user requests that map to the defined actions. For example, it includes rules for interpreting phrases like "Add milk to my grocery list" or "Clear my to-do list."
- **Handler**: The [listActionHandler.ts](./src/listActionHandler.ts) file implements the logic for each action. It processes the parsed user input and performs the necessary operations, such as adding items to a list or retrieving a list's contents.

## How to extend

To extend the `list-agent` package, you can add new actions, modify existing ones, or update the grammar to support additional user input patterns. Here are the steps to follow:

### Adding a New Action

1. **Define the Action**:

   - Add the new action type and its parameters to [listSchema.ts](./src/listSchema.ts).
   - For example, if you want to add an action to rename a list, define a new type `RenameListAction` with the necessary parameters.

2. **Update the Grammar**:

   - Add grammar rules for the new action in [listSchema.agr](./src/listSchema.agr). These rules should map user utterances to the new action and its parameters.

3. **Implement the Handler**:
   - Add the logic for the new action in [listActionHandler.ts](./src/listActionHandler.ts). Use the `executeListAction` function as the entry point for handling the action.

### Modifying Existing Actions

1. **Update the Schema**:

   - Modify the action type definitions in [listSchema.ts](./src/listSchema.ts) to reflect the changes.

2. **Adjust the Grammar**:

   - Update the corresponding grammar rules in [listSchema.agr](./src/listSchema.agr) to account for the changes in the action's parameters or behavior.

3. **Revise the Handler**:
   - Update the logic in [listActionHandler.ts](./src/listActionHandler.ts) to handle the modified action correctly.

### Testing Your Changes

1. **Write Tests**:

   - Add or update tests to cover the new or modified actions. Ensure that all possible scenarios are tested, including edge cases.

2. **Run Tests**:
   - Use the testing framework specified in the monorepo to run the tests and verify that your changes work as expected.

By following these steps, you can extend the `list-agent` package to support additional functionality or adapt it to your specific use case.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter list-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
