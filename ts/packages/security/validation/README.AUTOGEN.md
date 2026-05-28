<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=0977fd5362b98ef00a64e19d1d9d8d2634e4b055b1639fcce5d62f5c4b063239 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# validation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `validation` package is a core library for plan-validated agent execution within the TypeAgent monorepo. It provides the AgentPlan DSL, a 13-pass plan validator, an organization policy engine, and a runtime predicate evaluator. This package ensures that execution plans created by agents adhere to defined schemas and organizational policies, and evaluates runtime predicates to enforce constraints during execution.

## What it does

The `validation` package is responsible for validating execution plans created by agents. It ensures that the plans adhere to the defined schema and organizational policies, and evaluates runtime predicates to enforce constraints during execution. The package includes several key components:

- **AgentPlan DSL**: Defines the structure and syntax for agent plans.
- **Plan Validator**: A 13-pass validator that checks the integrity and correctness of plans.
- **Organization Policy Engine**: Enforces externally-defined constraints at both validation and runtime.
- **Runtime Predicate Evaluator**: Evaluates predicates that can be checked during plan execution.

The package supports actions such as `validatePlan`, `checkCircularDependencies`, and `evaluatePredicate`, which are crucial for ensuring the reliability and correctness of agent plans.

## Setup

To use the `validation` package, ensure you have the necessary dependencies installed. The package relies on `@anthropic-ai/claude-agent-sdk`. You can install the dependencies using `pnpm install`.

For detailed setup instructions, including environment variables and API keys, refer to the hand-written README.

## Key Files

The `validation` package is organized into several key files, each responsible for different aspects of plan validation and execution:

- [specSchema.ts](./src/specSchema.ts): Defines the complete logical syntax for agent plan specifications.
- [index.ts](./src/index.ts): Export barrel for the validation package, including schema types and validator functions.
- [claudePrint.ts](./src/claudePrint.ts): Functions for printing assistant and user messages using the Claude SDK.
- [orgPolicy.ts](./src/orgPolicy.ts): Organization policy layer that enforces constraints at validation and runtime.
- [planValidator.ts](./src/planValidator.ts): PDDL-style validator for AgentPlan specifications.
- [predicateEvaluator.ts](./src/predicateEvaluator.ts): Runtime evaluation of predicates.
- [prompts/planPrompt.ts](./src/prompts/planPrompt.ts): Constructs prompts for planning agents.
- [prompts/systemPrompt.ts](./src/prompts/systemPrompt.ts): System prompt for autonomous software engineer agents.

### Key Components

1. **AgentPlan DSL**: Defined in [specSchema.ts](./src/specSchema.ts), this file outlines the structure and syntax for agent plans, including elements like goals, steps, preconditions, and postconditions.

2. **Plan Validator**: Implemented in [planValidator.ts](./src/planValidator.ts), this component performs a 13-pass validation to ensure the integrity and correctness of agent plans. It checks various aspects such as structural integrity, binding correctness, and policy compliance.

3. **Organization Policy Engine**: Found in [orgPolicy.ts](./src/orgPolicy.ts), this engine enforces constraints defined by organizational policies. These constraints are applied both during plan validation and at runtime.

4. **Runtime Predicate Evaluator**: Located in [predicateEvaluator.ts](./src/predicateEvaluator.ts), this evaluator checks predicates that can be verified during plan execution, such as file existence and content matching.

5. **Prompts**: The package includes prompt construction files like [planPrompt.ts](./src/prompts/planPrompt.ts) and [systemPrompt.ts](./src/prompts/systemPrompt.ts), which help in generating structured prompts for planning agents and autonomous software engineer agents.

## How to extend

To extend the `validation` package, follow these steps:

1. **Understand the existing structure**: Familiarize yourself with the key files and their responsibilities.
2. **Add new schema definitions**: If you need to extend the AgentPlan DSL, modify [specSchema.ts](./src/specSchema.ts) to include new types and structures.
3. **Enhance validation logic**: To add new validation passes or improve existing ones, update [planValidator.ts](./src/planValidator.ts).
4. **Update policy enforcement**: If new organizational policies are required, modify [orgPolicy.ts](./src/orgPolicy.ts) to include new constraints.
5. **Extend predicate evaluation**: To support additional runtime predicates, enhance [predicateEvaluator.ts](./src/predicateEvaluator.ts).

Start by opening the relevant file based on the area you want to extend. Follow the existing patterns and ensure that your changes are well-tested. Run the tests to verify your modifications.

For detailed instructions on extending the package, refer to the hand-written README.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace: _None._

External: `@anthropic-ai/claude-agent-sdk`

### Used by

- mcp-plan-validation

### Files of interest

`./src/specSchema.ts`, `./src/index.ts`, `./src/claudePrint.ts`, …and 6 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:27:49.365Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter validation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
