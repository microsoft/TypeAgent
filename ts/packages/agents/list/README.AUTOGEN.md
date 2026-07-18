<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=735a3f8a1828e0478ff159ac3fe04ac5ad09a9a52781bf36295762cdf395309c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# list-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `list-agent` package is a TypeAgent application agent designed to manage lists. It provides a set of actions for creating, modifying, and retrieving lists, making it suitable for use cases such as to-do lists, shopping lists, or other item collections. This agent is part of the TypeAgent monorepo and integrates with other components to handle user requests related to list management.

## What it does

The `list-agent` supports a range of actions for managing lists, which are defined in its schema and implemented in its action handler. These actions include:

- **`addItems`**: Adds one or more items to a specified list. If the list does not exist, it will be created. This action requires the `items` (array of strings) and `listName` (string) parameters.
- **`removeItems`**: Removes one or more items from a specified list. This action requires the `items` (array of strings) and `listName` (string) parameters.
- **`createList`**: Creates a new list with the specified name. This action requires the `listName` (string) parameter.
- **`getList`**: Retrieves the contents of a specified list. This action is useful for queries like "What's on my grocery list?" or "What are the contents of my to-do list?" It requires the `listName` (string) parameter.
- **`clearList`**: Removes all items from a specified list. This action requires the `listName` (string) parameter.
- **`listLists`**: Lists all existing lists. This action is useful for queries like "What lists do I have?" or "Show me my lists."
- **`startEditList`**: Initiates the editing of a specified list. This action requires the `listName` (string) parameter.

These actions are defined in the [listSchema.ts](./src/listSchema.ts) file and implemented in the [listActionHandler.ts](./src/listActionHandler.ts) file. The agent uses schema definitions and grammar rules to interpret user input and map it to the appropriate actions.

## Setup

The `list-agent` package does not require any special setup beyond installing its dependencies. To get started:

1. Navigate to the package directory:
   ```sh
   cd ts/packages/agents/list/
   ```
2. Install the required dependencies:
   ```sh
   pnpm install
   ```

For additional details, refer to the hand-written README.

## Key Files

The `list-agent` package is structured around several key files that define its behavior and functionality:

- **[listManifest.json](./src/listManifest.json)**: Contains metadata about the agent, including its description, emoji representation, and references to the schema and grammar files.
- **[listSchema.ts](./src/listSchema.ts)**: Defines the action types and their parameters. This file is the core of the agent's functionality, specifying the actions the agent can perform and the data they require.
- **[listSchema.agr](./src/listSchema.agr)**: Contains grammar rules that map user utterances to actions. These rules help the agent interpret natural language input and determine the appropriate action to execute.
- **[listActionHandler.ts](./src/listActionHandler.ts)**: Implements the logic for handling the actions defined in the schema. This file contains the code that executes the behavior of each action.

### File Responsibilities

- **Manifest**: The [listManifest.json](./src/listManifest.json) file provides a high-level overview of the agent, including its purpose and the files it depends on.
- **Schema**: The [listSchema.ts](./src/listSchema.ts) file defines the structure of the actions and their parameters. For example, the `addItems` action requires an array of items and a list name.
- **Grammar**: The [listSchema.agr](./src/listSchema.agr) file contains patterns for user input, such as "Add milk to my grocery list," and maps them to the corresponding actions.
- **Handler**: The [listActionHandler.ts](./src/listActionHandler.ts) file contains the implementation of the actions. For instance, it defines how to add items to a list or retrieve the contents of a list.

## How to extend

To extend the functionality of the `list-agent` package, follow these steps:

### 1. Add a New Action

- **Define the action**: Add the new action type and its parameters in [listSchema.ts](./src/listSchema.ts). For example:
  ```ts
  export type NewAction = {
    actionName: "newAction";
    parameters: {
      param1: string;
      param2: number;
    };
  };
  ```
- **Add grammar rules**: Define grammar rules for the new action in [listSchema.agr](./src/listSchema.agr). These rules should map user input to the new action. For example:
  ```text
  <NewAction> = do something with $(param1:wildcard) and $(param2:number) -> {
      actionName: "newAction",
      parameters: {
          param1,
          param2
      }
  }
  ```
- **Implement the action**: Add the logic for the new action in [listActionHandler.ts](./src/listActionHandler.ts). For example:
  ```ts
  async function handleNewAction(action: NewAction, context: ActionContext) {
    // Your implementation here
    return createActionResultFromTextDisplay("Action executed successfully.");
  }
  ```

### 2. Modify Existing Actions

- Update the action type definitions in [listSchema.ts](./src/listSchema.ts) to reflect the changes.
- Adjust the corresponding grammar rules in [listSchema.agr](./src/listSchema.agr) to ensure they align with the updated action.
- Modify the implementation in [listActionHandler.ts](./src/listActionHandler.ts) to handle the updated behavior.

### 3. Test Your Changes

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

_Auto-generated against commit `2c26e6d289e04ac54b08f8483b292693a8d4bb64` on `2026-07-18T00:58:44.432Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter list-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
