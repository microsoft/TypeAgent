<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ca5cde74d08d12cf50f41bcd27d11ca069f1f9b0f159dedf393d70c0e2302f3e -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# validation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `validation` package is a core library in the TypeAgent monorepo designed for plan-validated agent execution. It provides the foundational tools and components necessary to define, validate, and enforce execution plans for agents. These include the AgentPlan DSL, a comprehensive 13-pass plan validator, an organization policy engine, and a runtime predicate evaluator. Together, these components ensure that agent plans adhere to predefined schemas, comply with organizational policies, and meet runtime constraints.

## What it does

The `validation` package is responsible for ensuring the correctness, compliance, and feasibility of execution plans created by agents. It achieves this through the following key features:

- **AgentPlan DSL**: A domain-specific language that defines the structure and syntax for agent plans, including goals, steps, preconditions, postconditions, and constraints.
- **Plan Validator**: A multi-pass validation system that performs 13 distinct checks to ensure the structural integrity, logical consistency, and policy compliance of agent plans.
- **Organization Policy Engine**: Enforces constraints defined by organizational policies, such as tool usage restrictions, file access rules, and resource limits. These policies are applied both during the validation phase and at runtime.
- **Runtime Predicate Evaluator**: Evaluates predicates that can be checked during plan execution, such as file existence, content matching, and logical conditions.

The package provides actions such as `validatePlan`, `checkCircularDependencies`, and `evaluatePredicate`. These actions are essential for verifying the validity of plans, detecting potential issues like circular dependencies, and evaluating runtime conditions.

## Setup

To use the `validation` package, you need to install its dependencies. The package depends on the external library `@anthropic-ai/claude-agent-sdk`. Install the required dependencies by running:

```bash
pnpm install
```

No additional environment variables or API keys are required for this package. For further details, refer to the hand-written README.

## Key Files

The `validation` package is structured into several key files, each serving a specific purpose in the validation and execution process:

- [specSchema.ts](./src/specSchema.ts): Defines the logical syntax for agent plans, including their structure, goals, steps, and constraints.
- [index.ts](./src/index.ts): Acts as the main entry point for the package, exporting schema types and core validation functions.
- [claudePrint.ts](./src/claudePrint.ts): Provides utility functions for formatting and printing messages using the Claude SDK.
- [orgPolicy.ts](./src/orgPolicy.ts): Implements the organization policy engine, which enforces constraints during validation and runtime.
- [planValidator.ts](./src/planValidator.ts): Contains the 13-pass validation logic for ensuring the correctness and compliance of agent plans.
- [predicateEvaluator.ts](./src/predicateEvaluator.ts): Handles the runtime evaluation of predicates, such as file existence and logical conditions.
- [prompts/planPrompt.ts](./src/prompts/planPrompt.ts): Constructs prompts for planning agents, including the AgentPlan JSON schema.
- [prompts/systemPrompt.ts](./src/prompts/systemPrompt.ts): Provides a system prompt for autonomous software engineer agents to guide their workflows.

### Key Components

1. **AgentPlan DSL**: The DSL is defined in [specSchema.ts](./src/specSchema.ts). It specifies the structure of agent plans, including elements like goals, steps, preconditions, postconditions, and constraints. This file serves as the foundation for all plan-related operations.

2. **Plan Validator**: The 13-pass validation logic is implemented in [planValidator.ts](./src/planValidator.ts). Each pass checks a specific aspect of the plan, such as structural integrity, binding correctness, and compliance with organizational policies.

3. **Organization Policy Engine**: The policy engine in [orgPolicy.ts](./src/orgPolicy.ts) enforces constraints defined by organizational policies. These constraints include tool usage restrictions, file access rules, and resource limits.

4. **Runtime Predicate Evaluator**: Found in [predicateEvaluator.ts](./src/predicateEvaluator.ts), this component evaluates runtime predicates, such as file existence, content matching, and logical conditions. It ensures that plans adhere to runtime constraints.

5. **Prompts**: The package includes [planPrompt.ts](./src/prompts/planPrompt.ts) and [systemPrompt.ts](./src/prompts/systemPrompt.ts), which generate structured prompts for planning agents and autonomous software engineer agents.

## How to extend

To extend the `validation` package, follow these steps:

1. **Understand the existing structure**: Review the key files and their responsibilities to understand how the package is organized.
2. **Modify the AgentPlan DSL**: To add new features or structures to the AgentPlan syntax, update [specSchema.ts](./src/specSchema.ts). Ensure that any new elements are well-documented and integrated into the existing schema.
3. **Enhance validation logic**: If additional validation passes are needed, or if existing ones require updates, modify [planValidator.ts](./src/planValidator.ts). Follow the existing patterns for adding new validation phases.
4. **Update policy enforcement**: To introduce new organizational policies, extend [orgPolicy.ts](./src/orgPolicy.ts). This may include adding new constraints or modifying existing ones.
5. **Expand predicate evaluation**: If new runtime predicates are required, enhance [predicateEvaluator.ts](./src/predicateEvaluator.ts). Ensure that the new predicates are properly tested and integrated into the evaluation context.
6. **Adapt prompts**: If the prompts for planning agents or autonomous software engineer agents need to be updated, modify [planPrompt.ts](./src/prompts/planPrompt.ts) or [systemPrompt.ts](./src/prompts/systemPrompt.ts).

When making changes, ensure that you follow the existing code style and patterns. Test your modifications thoroughly to maintain the integrity and reliability of the package. For additional guidance, consult the hand-written README.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter validation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
