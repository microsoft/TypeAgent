<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=835455e8c175de27561845dbe0357bd66dc9a775eb3a75f4efab1d1d36349478 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# test-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `test-agent` package is a dispatch agent within the TypeAgent framework, designed specifically for testing purposes. It provides a simple interface for executing predefined actions, such as performing mathematical operations and generating random numbers. This agent is a lightweight and focused tool for testing and demonstration scenarios.

## What it does

The `test-agent` supports a small set of actions, which are defined in its schema and implemented in its handler. These actions include:

- **`add`**: Performs the addition of two numbers. The action takes two parameters, `a` and `b`, and returns their sum.
- **`random`**: Generates a random number. This action does not require any parameters and returns a randomly generated value.

The agent's behavior is defined in the [schema.ts](./src/schema.ts) file, which specifies the structure of the supported actions, and the [handler.ts](./src/handler.ts) file, which implements the logic for processing these actions. The agent's metadata, such as its emoji representation and description, is defined in the [manifest.json](./src/manifest.json) file.

The `test-agent` also includes a command interface, allowing users to interact with the agent through commands. For example, the `request` command, implemented in the `RequestCommandHandler` class, allows users to request a test and display the result.

## Setup

Setting up the `test-agent` package is straightforward:

1. Install the required dependencies by running:
   ```bash
   pnpm install
   ```
2. No additional environment variables, API keys, or external accounts are required for this package.

Once the dependencies are installed, the agent is ready to use.

## Key Files

The `test-agent` package is organized into the following key files:

- **[manifest.json](./src/manifest.json)**: This file contains the agent's metadata, including its emoji representation (`➕`), a description of its purpose, and the schema details. The schema is linked to the [schema.ts](./src/schema.ts) file and defines the supported actions.

- **[schema.ts](./src/schema.ts)**: This file defines the `TestActions` type, which includes the structure of the supported actions:

  - `AddAction`: Represents the `add` action, which requires two parameters, `a` and `b`, both of type `number`.
  - `RandomNumberAction`: Represents the `random` action, which does not require any parameters.

- **[handler.ts](./src/handler.ts)**: This file contains the logic for handling the actions defined in the schema. Key components include:

  - `RequestCommandHandler`: A class that implements the `request` command, allowing users to request a test and display the result.
  - `handlers` object: Defines the available commands and their corresponding handlers.
  - `executeAction` function: Implements the logic for executing the `add` and `random` actions. For example:
    - The `add` action calculates the sum of two numbers and returns the result.
    - The `random` action generates and returns a random number.

- **[tsconfig.json](./src/tsconfig.json)**: Configures the TypeScript compiler for the package, extending the base configuration from the monorepo and specifying the input and output directories.

## How to extend

To extend the functionality of the `test-agent` package, follow these steps:

1. **Define new actions**:

   - Open the [schema.ts](./src/schema.ts) file.
   - Add a new action type to the `TestActions` union. For example:
     ```ts
     type MultiplyAction = {
       actionName: "multiply";
       parameters: {
         a: number;
         b: number;
       };
     };
     export type TestActions = AddAction | RandomNumberAction | MultiplyAction;
     ```

2. **Implement the action logic**:

   - Open the [handler.ts](./src/handler.ts) file.
   - Add a new case to the `executeAction` function to handle the new action. For example:
     ```ts
     case "multiply":
         const { a, b } = action.parameters;
         return createActionResult(`The product of ${a} and ${b} is ${a * b}`);
     ```

3. **Add new commands (if needed)**:

   - Update the `handlers` object in the [handler.ts](./src/handler.ts) file to include new command handlers. For example:
     ```ts
     const handlers = {
       description: "Test App Agent Commands",
       commands: {
         request: new RequestCommandHandler(),
         multiply: new MultiplyCommandHandler(), // Add your new command handler here
       },
     };
     ```

4. **Test your changes**:
   - Write or update test cases to cover the new actions and commands. Ensure that all tests pass before committing your changes.

By following these steps, you can add new functionality to the `test-agent` package while maintaining its structure and consistency.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/manifest.json](./src/manifest.json)
- `./agent/handlers` → `./dist/handler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Files of interest

`./src/manifest.json`, `./src/handler.ts`, `./src/schema.ts`, …and 1 more under `./src/`.

### Agent surface

- Manifest: [./src/manifest.json](./src/manifest.json)

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter test-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
