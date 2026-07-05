<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=7c66e76fa860df7771beb0801435d7cc4788156ede6bd4870d5e489b7fb5cc18 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# list-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `list-agent` package is a TypeAgent application agent designed to manage lists. It provides a set of actions for creating, modifying, and retrieving lists, making it suitable for use cases such as to-do lists, shopping lists, or any other type of item collection. This agent is part of the TypeAgent monorepo and integrates with other components in the system to handle user requests related to list management.

## What it does

The `list-agent` package supports six actions that allow users to interact with lists:

- **`addItems`**: Adds one or more items to a specified list. If the list does not exist, it is created. This action is useful for tasks like adding groceries or tasks to a list.
- **`removeItems`**: Removes one or more items from a specified list. This action is used to delete specific items from a list.
- **`createList`**: Creates a new list with a specified name. This action is useful for initializing a new list for a specific purpose.
- **`getList`**: Retrieves the contents of a specified list. This action is helpful for answering user queries such as "What's on my grocery list?" or "What are the contents of my to-do list?"
- **`clearList`**: Clears all items from a specified list. This action is used to reset a list to an empty state.
- **`startEditList`**: Initiates the editing of a specified list. This action is useful for workflows that involve making multiple changes to a list.

These actions are defined in the [listSchema.ts](./src/listSchema.ts) file and are implemented in the [listActionHandler.ts](./src/listActionHandler.ts) file. The agent uses a combination of schema definitions and grammar rules to interpret user input and map it to the appropriate actions.

## Setup

The `list-agent` package does not require any special setup beyond installing its dependencies. To get started, run the following command in the package directory:

```sh
pnpm install
```

If additional setup steps are required, refer to the hand-written README for more details.

## Key Files

The `list-agent` package is organized into several key files that define its functionality and behavior:

- **[listManifest.json](./src/listManifest.json)**: This file contains metadata about the agent, including its description, emoji representation, and references to the schema and grammar files.
- **[listSchema.ts](./src/listSchema.ts)**: This file defines the action types and their parameters. It is the primary source for understanding the capabilities of the agent.
- **[listSchema.agr](./src/listSchema.agr)**: This file contains grammar rules that map user utterances to specific actions. It defines how the agent interprets natural language input.
- **[listActionHandler.ts](./src/listActionHandler.ts)**: This file implements the logic for handling the actions defined in the schema. It is the core of the agent's functionality.

### File Responsibilities

1. **[listManifest.json](./src/listManifest.json)**:

   - Describes the agent's purpose and capabilities.
   - Specifies the schema and grammar files used by the agent.

2. **[listSchema.ts](./src/listSchema.ts)**:

   - Defines the structure and parameters of the actions (`addItems`, `removeItems`, `createList`, `getList`, `clearList`, and `startEditList`).
   - Serves as the contract for the agent's capabilities.

3. **[listSchema.agr](./src/listSchema.agr)**:

   - Contains grammar rules that map user input to actions.
   - For example, the rule `add $(item:wildcard) to $(listName:wildcard)` maps a user request like "add milk to grocery list" to the `addItems` action with the parameters `items: ["milk"]` and `listName: "grocery"`.

4. **[listActionHandler.ts](./src/listActionHandler.ts)**:
   - Implements the business logic for each action.
   - For example, the `executeListAction` function processes the action and interacts with the agent's context to perform the requested operation.

## How to extend

To extend the `list-agent` package, you can add new actions, modify existing ones, or update the grammar rules. Here are the steps to follow:

### Adding a New Action

1. **Define the Action**:

   - Add a new action type to [listSchema.ts](./src/listSchema.ts), specifying its name and parameters.

2. **Update the Grammar**:

   - Add new grammar rules to [listSchema.agr](./src/listSchema.agr) to map user input to the new action.

3. **Implement the Action**:

   - Add the logic for the new action in [listActionHandler.ts](./src/listActionHandler.ts). Use the `executeListAction` function as the entry point for handling the action.

4. **Update the Manifest**:

   - If necessary, update [listManifest.json](./src/listManifest.json) to include metadata about the new action.

5. **Test the Action**:
   - Write unit tests to verify the new action's functionality.
   - Run the tests to ensure everything works as expected.

### Modifying Existing Actions

1. **Update the Schema**:

   - Modify the action type definition in [listSchema.ts](./src/listSchema.ts) to reflect the changes.

2. **Adjust the Grammar**:

   - Update the corresponding grammar rules in [listSchema.agr](./src/listSchema.agr) to match the updated action.

3. **Revise the Handler**:

   - Update the logic in [listActionHandler.ts](./src/listActionHandler.ts) to handle the modified action.

4. **Test the Changes**:
   - Update existing tests or add new ones to cover the changes.
   - Run the tests to ensure the modifications work as intended.

### Testing and Validation

- Use the test framework provided in the monorepo to validate your changes.
- Ensure that all existing and new tests pass before committing your changes.

By following these guidelines, you can effectively extend or modify the `list-agent` package to suit your application's needs.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter list-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
