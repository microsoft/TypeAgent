<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=341b9205df81281a88faf12ea1b66f5f8e92e53e52a61657e9f8825752d743e3 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/agent-flows — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/agent-flows` package provides shared workflow infrastructure for TypeAgent flow agents. It includes utilities for script validation, execution, grammar generation, and schema building, enabling consistent and secure handling of flow actions across different agents.

## What it does

This package offers several key functionalities:

- **Script Validation**: Ensures that scripts adhere to predefined rules and constraints, preventing the use of dangerous calls and blocked identifiers.
  - Actions: `createScriptValidator`, `transpileScript`
- **Script Execution**: Executes scripts within a controlled environment, applying necessary overrides and timeouts.
  - Actions: `createScriptExecutor`
- **Grammar Generation**: Constructs grammar rules for parsing and interpreting flow actions.
  - Actions: `generateGrammarRuleText`, `extractRuleNames`, `buildStartRule`, `assembleDynamicGrammar`
- **Schema Building**: Generates TypeScript types for flow actions, facilitating type-safe interactions.
  - Actions: `generateFlowActionTypes`, `buildUnionType`
- **Sandbox Declaration**: Generates TypeScript declarations for sandbox environments, ensuring scripts run with the correct context.
  - Actions: `createSandboxDeclarationGenerator`

These functionalities are used by various TypeAgent packages, such as `browser-typeagent`, `powershell-typeagent`, and `taskflow-typeagent`.

## Setup

No additional setup is required beyond installing the package. Simply run:

```sh
pnpm install @typeagent/agent-flows
```

## Key Files

The package is organized into several modules, each responsible for a specific aspect of the workflow infrastructure:

- **[index.ts](./src/index.ts)**: Entry point that exports types and functions from other modules.
- **[execution/scriptExecutor.ts](./src/execution/scriptExecutor.ts)**: Contains logic for executing scripts, including handling blocked identifiers and timeouts.
- **[grammar/grammarBuilder.ts](./src/grammar/grammarBuilder.ts)**: Provides functions for generating grammar rules and extracting rule names.
- **[sandbox/declarationGenerator.ts](./src/sandbox/declarationGenerator.ts)**: Generates TypeScript declarations for sandbox environments.
- **[schema/schemaBuilder.ts](./src/schema/schemaBuilder.ts)**: Builds TypeScript types for flow actions.
- **[validation/scriptValidator.ts](./src/validation/scriptValidator.ts)**: Validates scripts against predefined rules and constraints.
- **[types.ts](./src/types.ts)**: Defines TypeScript interfaces and types used across the package.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Identify the module to extend**: Determine which aspect of the workflow infrastructure you need to modify or enhance (e.g., script validation, execution, grammar generation).
2. **Open the relevant file**: Navigate to the corresponding module file (e.g., [scriptValidator.ts](./src/validation/scriptValidator.ts) for script validation).
3. **Implement your changes**: Add or modify functions and types as needed. Ensure your changes adhere to the existing patterns and conventions.
4. **Update exports**: If you add new functions or types, make sure to export them in [index.ts](./src/index.ts).
5. **Test your changes**: Write tests to verify the new functionality. Ensure all existing tests pass.

By following these steps, you can effectively extend the capabilities of the `@typeagent/agent-flows` package while maintaining consistency and reliability.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace: _None._

External: `typescript`

### Used by

- [browser-typeagent](../../packages/agents/browser/README.md)
- powershell-typeagent
- taskflow-typeagent

### Files of interest

`./src/index.ts`, `./src/execution/scriptExecutor.ts`, `./src/grammar/grammarBuilder.ts`, …and 5 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/agent-flows docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
