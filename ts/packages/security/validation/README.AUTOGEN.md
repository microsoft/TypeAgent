<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ca5cde74d08d12cf50f41bcd27d11ca069f1f9b0f159dedf393d70c0e2302f3e -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# validation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `validation` package is a core library in the TypeAgent monorepo that provides essential tools for plan-validated agent execution. It includes the AgentPlan DSL, a 13-pass plan validator, an organization policy engine, and a runtime predicate evaluator. These components work together to ensure that execution plans created by agents comply with predefined schemas, organizational policies, and runtime constraints.

This package is a foundational component for ensuring the correctness, compliance, and reliability of agent-generated plans, making it a critical part of the TypeAgent ecosystem.

## What it does

The `validation` package is designed to validate and enforce rules for agent-generated execution plans. It provides the following key capabilities:

- **AgentPlan DSL**: A domain-specific language that defines the structure and syntax for agent plans, including goals, steps, preconditions, postconditions, and constraints.
- **Plan Validator**: A multi-pass validator that checks the integrity, correctness, and compliance of plans. It performs structural validation, ensures binding correctness, and verifies adherence to organizational policies.
- **Organization Policy Engine**: Enforces externally-defined constraints, such as tool usage restrictions, file path policies, and resource limits, both during validation and at runtime.
- **Runtime Predicate Evaluator**: Evaluates predicates that can be checked during plan execution, such as file existence, content matching, and logical conditions.

The package supports actions such as `validatePlan`, `checkCircularDependencies`, and `evaluatePredicate`, which are used to validate plans, detect issues like circular dependencies, and enforce runtime constraints.

## Setup

To use the `validation` package, follow these steps:

1. **Install dependencies**: The package depends on `@anthropic-ai/claude-agent-sdk`. Install it using `pnpm install`.
2. **Environment setup**: No specific environment variables or API keys are required for this package. However, ensure that your project is configured to use the TypeAgent monorepo structure.

For additional setup details, refer to the hand-written README.

## Key Files

The `validation` package is organized into several key files, each responsible for specific aspects of plan validation and execution:

- [specSchema.ts](./src/specSchema.ts): Defines the logical syntax for agent plans, including elements like goals, steps, preconditions, and postconditions.
- [index.ts](./src/index.ts): Serves as the export barrel for the package, exposing schema types and validator functions.
- [claudePrint.ts](./src/claudePrint.ts): Provides utility functions for printing assistant and user messages using the Claude SDK.
- [orgPolicy.ts](./src/orgPolicy.ts): Implements the organization policy engine, which enforces constraints during validation and runtime.
- [planValidator.ts](./src/planValidator.ts): Contains the 13-pass validator for checking the integrity and correctness of agent plans.
- [predicateEvaluator.ts](./src/predicateEvaluator.ts): Handles runtime evaluation of predicates, such as file and content checks.
- [prompts/planPrompt.ts](./src/prompts/planPrompt.ts): Constructs prompts for planning agents, including the AgentPlan JSON schema.
- [prompts/systemPrompt.ts](./src/prompts/systemPrompt.ts): Defines the system prompt for autonomous software engineer agents.

### Key Components

1. **AgentPlan DSL**: Defined in [specSchema.ts](./src/specSchema.ts), this file outlines the structure and syntax for agent plans, including support for goals, steps, and constraints.
2. **Plan Validator**: Implemented in [planValidator.ts](./src/planValidator.ts), this component performs a 13-pass validation process to ensure plans are structurally sound and compliant with policies.
3. **Organization Policy Engine**: Found in [orgPolicy.ts](./src/orgPolicy.ts), this engine enforces constraints such as tool restrictions, file path policies, and resource limits.
4. **Runtime Predicate Evaluator**: Located in [predicateEvaluator.ts](./src/predicateEvaluator.ts), this evaluator checks runtime predicates like file existence and logical conditions.
5. **Prompts**: The package includes prompt construction files like [planPrompt.ts](./src/prompts/planPrompt.ts) and [systemPrompt.ts](./src/prompts/systemPrompt.ts), which help generate structured prompts for agents.

## How to extend

To extend the `validation` package, follow these steps:

1. **Understand the existing structure**: Review the key files and their responsibilities to identify where your changes fit.
2. **Modify the AgentPlan DSL**: To add new schema elements, update [specSchema.ts](./src/specSchema.ts) with the required types and structures.
3. **Enhance validation logic**: If additional validation passes are needed, implement them in [planValidator.ts](./src/planValidator.ts).
4. **Update policy enforcement**: To introduce new organizational policies, modify [orgPolicy.ts](./src/orgPolicy.ts) to include the new constraints.
5. **Extend predicate evaluation**: Add support for new runtime predicates by enhancing [predicateEvaluator.ts](./src/predicateEvaluator.ts).

When making changes, follow the existing patterns in the codebase and ensure your modifications are well-tested. Run the test suite to verify that your changes do not introduce regressions. For further guidance, consult the hand-written README.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace: _None._

External: `@anthropic-ai/claude-agent-sdk`

### Used by

- mcp-plan-validation

### Files of interest

`./src/specSchema.ts`, `./src/index.ts`, `./src/claudePrint.ts`, …and 6 more under `./src/`.

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-12T08:45:00.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter validation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
