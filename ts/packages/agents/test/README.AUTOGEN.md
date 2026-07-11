<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=835455e8c175de27561845dbe0357bd66dc9a775eb3a75f4efab1d1d36349478 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# test-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `test-agent` package is a dispatch agent within the TypeAgent framework, designed for testing purposes. It provides a simple interface for executing mathematical operations and generating random numbers, making it a useful tool for testing and demonstration scenarios.

## What it does

The `test-agent` package supports two primary actions:

- `add`: Adds two numbers and returns the result.
- `random`: Generates a random number.

These actions are defined in the [schema.ts](./src/schema.ts) file and implemented in the [handler.ts](./src/handler.ts) file. The agent processes commands and executes the corresponding actions, returning results in a structured format.

The agent's metadata, including its emoji representation (`➕`) and description, is defined in the [manifest.json](./src/manifest.json) file. This metadata provides context about the agent's purpose and capabilities.

## Setup

Setting up the `test-agent` package is straightforward:

1. Install the required dependencies by running `pnpm install` in the workspace root.
2. No additional environment variables, API keys, or external accounts are required for this package.

Once the dependencies are installed, the agent is ready to use.

## Key Files

The `test-agent` package is organized into a few key files that define its functionality:

- [manifest.json](./src/manifest.json): Contains metadata about the agent, including its emoji, description, and schema details. This file is essential for registering the agent within the TypeAgent framework.
- [schema.ts](./src/schema.ts): Defines the types for the actions supported by the agent. It includes the `TestActions` type, which enumerates the `add` and `random` actions.
- [handler.ts](./src/handler.ts): Implements the logic for handling actions. This file includes:
  - The `RequestCommandHandler` class, which defines a command interface for requesting tests.
  - The `executeAction` function, which processes actions and executes the corresponding logic.
  - The `handlers` object, which maps commands to their respective handlers.
- [tsconfig.json](./src/tsconfig.json): Configures TypeScript compilation settings for the package.

These files collectively define the agent's behavior, from its metadata to its action handling logic.

## How to extend

To extend the `test-agent` package, follow these steps:

1. **Define new actions**:

   - Open the [schema.ts](./src/schema.ts) file.
   - Add new action types to the `TestActions` union type. For example, to add a subtraction action, define a new type:
     ```ts
     type SubtractAction = {
       actionName: "subtract";
       parameters: {
         a: number;
         b: number;
       };
     };
     ```
     Then, include it in the `TestActions` union:
     ```ts
     export type TestActions = AddAction | RandomNumberAction | SubtractAction;
     ```

2. **Implement action logic**:

   - Open the [handler.ts](./src/handler.ts) file.
   - Add a new case to the `executeAction` function to handle the new action:
     ```ts
     case "subtract":
         const { a, b } = action.parameters;
         return createActionResult(`The difference between ${a} and ${b} is ${a - b}`);
     ```

3. **Add new commands (if needed)**:

   - If the new action requires a command interface, update the `handlers` object in [handler.ts](./src/handler.ts) to include a new command handler. For example:

     ```ts
     class SubtractCommandHandler implements CommandHandler {
       public readonly description = "Subtract two numbers";
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
         const result = params.args.a - params.args.b;
         context.actionIO.setDisplay(`The result is ${result}`);
       }
     }

     const handlers = {
       description: "Test App Agent Commands",
       commands: {
         request: new RequestCommandHandler(),
         subtract: new SubtractCommandHandler(),
       },
     };
     ```

4. **Test your changes**:
   - Add or update test cases to verify the new functionality. Ensure that the new actions and commands work as expected.

By following these steps, you can extend the `test-agent` package to support additional actions and commands, tailoring it to your specific testing needs.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter test-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
