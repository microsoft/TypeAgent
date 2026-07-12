<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=835455e8c175de27561845dbe0357bd66dc9a775eb3a75f4efab1d1d36349478 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# test-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `test-agent` package is a dispatch agent within the TypeAgent framework, designed specifically for testing purposes. It provides a simple interface for executing predefined actions, such as performing mathematical operations and generating random numbers. This agent is primarily used for testing and demonstration purposes within the broader TypeAgent ecosystem.

## What it does

The `test-agent` supports two primary actions:

- **`add`**: This action takes two numbers as input parameters (`a` and `b`) and returns their sum. It is useful for testing basic arithmetic operations.
- **`random`**: This action generates a random number. It does not require any input parameters and is useful for testing random number generation functionality.

These actions are defined in the [schema.ts](./src/schema.ts) file, which specifies the structure and types of the actions. The logic for handling these actions is implemented in the [handler.ts](./src/handler.ts) file. The agent's metadata, including its emoji representation and description, is defined in the [manifest.json](./src/manifest.json) file.

The agent also includes a command interface, allowing users to interact with it using commands. For example, the `request` command, handled by the `RequestCommandHandler` class, allows users to request a test and display the result.

## Setup

Setting up the `test-agent` package is straightforward:

1. Ensure you have the necessary dependencies installed by running:
   ```bash
   pnpm install
   ```
2. No additional environment variables, API keys, or external accounts are required for this package.

Once the dependencies are installed, the agent is ready to use.

## Key Files

The `test-agent` package is organized into the following key files:

- **[manifest.json](./src/manifest.json)**: This file defines the agent's metadata, including its emoji representation (`➕`), description, and schema details. It also specifies the schema file and type used by the agent.
- **[schema.ts](./src/schema.ts)**: This file defines the `TestActions` type, which includes the structure and parameters for the supported actions:

  - `AddAction`: Represents the `add` action, which requires two numeric parameters (`a` and `b`).
  - `RandomNumberAction`: Represents the `random` action, which does not require any parameters.

- **[handler.ts](./src/handler.ts)**: This file contains the core logic for the agent. Key components include:
  - `RequestCommandHandler`: A class that defines the `request` command, allowing users to request a test and display the result.
  - `handlers` object: Defines the available commands and their corresponding handlers.
  - `executeAction` function: Implements the logic for executing the `add` and `random` actions. For example:
    - The `add` action calculates the sum of two numbers and returns the result.
    - The `random` action generates and returns a random number.
  - `instantiate` function: Sets up the agent by combining the command interface and action execution logic.

## How to extend

To extend the functionality of the `test-agent`, follow these steps:

1. **Define new actions**:

   - Open the [schema.ts](./src/schema.ts) file.
   - Add new action types to the `TestActions` union type. For example:
     ```ts
     type MultiplyAction = {
       actionName: "multiply";
       parameters: {
         a: number;
         b: number;
       };
     };
     ```
     Update the `TestActions` type to include the new action:
     ```ts
     export type TestActions = AddAction | RandomNumberAction | MultiplyAction;
     ```

2. **Implement action logic**:

   - Open the [handler.ts](./src/handler.ts) file.
   - Add a new case to the `executeAction` function to handle the new action. For example:
     ```ts
     case "multiply":
         const { a, b } = action.parameters;
         return createActionResult(`The product of ${a} and ${b} is ${a * b}`);
     ```

3. **Add new commands (if needed)**:

   - If the new action requires a command, update the `handlers` object in the [handler.ts](./src/handler.ts) file. Define a new `CommandHandler` for the command and add it to the `commands` object. For example:

     ```ts
     class MultiplyCommandHandler implements CommandHandler {
       public readonly description = "Multiply two numbers";
       public readonly parameters = {
         args: {
           a: { description: "First number" },
           b: { description: "Second number" },
         },
       } as const;
       public async run(
         context: ActionContext<void>,
         params: ParsedCommandParams<typeof this.parameters>,
       ) {
         const result = params.args.a * params.args.b;
         context.actionIO.setDisplay(`The product is ${result}`);
       }
     }

     const handlers = {
       description: "Test App Agent Commands",
       commands: {
         request: new RequestCommandHandler(),
         multiply: new MultiplyCommandHandler(),
       },
     };
     ```

4. **Test your changes**:
   - Add or update test cases to verify the new functionality. Ensure that the new actions and commands work as expected.

By following these steps, you can extend the `test-agent` package to support additional actions and commands, making it more versatile for testing purposes.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-12T08:45:00.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter test-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
