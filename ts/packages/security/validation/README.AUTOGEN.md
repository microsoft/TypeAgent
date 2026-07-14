<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ca5cde74d08d12cf50f41bcd27d11ca069f1f9b0f159dedf393d70c0e2302f3e -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# validation — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `validation` package is a core library in the TypeAgent monorepo designed for plan-validated agent execution. It provides the foundational tools and components necessary to define, validate, and enforce execution plans for agents. These include the AgentPlan DSL, a comprehensive 13-pass plan validator, an organization policy engine, and a runtime predicate evaluator. Together, these components ensure that agent-generated plans adhere to predefined schemas, comply with organizational policies, and meet runtime constraints.

## What it does

The `validation` package is responsible for ensuring the correctness, compliance, and feasibility of execution plans created by agents. It achieves this through the following key features:

- **AgentPlan DSL**: A domain-specific language that defines the structure and syntax for agent plans, including goals, steps, preconditions, postconditions, and constraints.
- **Plan Validator**: A multi-pass validation system that performs 13 distinct checks to verify the structural integrity, logical consistency, and policy compliance of agent plans.
- **Organization Policy Engine**: Enforces constraints defined by organizational policies, such as tool usage restrictions, file access rules, and resource limits. These policies are applied both during the validation phase and at runtime.
- **Runtime Predicate Evaluator**: Evaluates predicates that can be checked during plan execution, such as file existence, content matching, and logical conditions.

The package provides actions such as `validatePlan`, `checkCircularDependencies`, and `evaluatePredicate`. These actions are essential for verifying the validity of plans, detecting potential issues like circular dependencies, and ensuring that runtime conditions are met.

## Setup

To use the `validation` package, you need to install its dependencies. The package depends on the external library `@anthropic-ai/claude-agent-sdk`. You can install the required dependencies by running:

```bash
pnpm install
```

No additional environment variables or external setup steps are required. For further details, refer to the hand-written README.

## Key Files

The `validation` package is organized into several key files, each serving a specific purpose in the validation and execution process:

- [specSchema.ts](./src/specSchema.ts): Defines the AgentPlan DSL, including the schema for agent plans, such as goals, steps, preconditions, postconditions, and constraints.
- [index.ts](./src/index.ts): Serves as the main entry point for the package, exporting schema types, validation functions, and other utilities.
- [claudePrint.ts](./src/claudePrint.ts): Provides functions for formatting and printing assistant and user messages using the Claude SDK.
- [orgPolicy.ts](./src/orgPolicy.ts): Implements the organization policy engine, which enforces constraints during both validation and runtime.
- [planValidator.ts](./src/planValidator.ts): Contains the 13-pass validation logic for ensuring the correctness and compliance of agent plans.
- [predicateEvaluator.ts](./src/predicateEvaluator.ts): Handles the runtime evaluation of predicates, such as file existence and logical conditions.
- [prompts/planPrompt.ts](./src/prompts/planPrompt.ts): Constructs prompts for planning agents, including the AgentPlan JSON schema.
- [prompts/systemPrompt.ts](./src/prompts/systemPrompt.ts): Defines the system prompt for autonomous software engineer agents, outlining their workflow and rules.

### Key Components

1. **AgentPlan DSL**: Defined in [specSchema.ts](./src/specSchema.ts), this DSL specifies the structure of agent plans, including elements like goals, steps, and constraints. It serves as the foundation for all validation and execution processes.

2. **Plan Validator**: The 13-pass validation process in [planValidator.ts](./src/planValidator.ts) ensures that agent plans are structurally sound, logically consistent, and compliant with organizational policies. Each pass focuses on a specific aspect, such as structural integrity, binding correctness, or policy enforcement.

3. **Organization Policy Engine**: Found in [orgPolicy.ts](./src/orgPolicy.ts), this engine enforces externally-defined constraints, such as tool usage restrictions and file access policies. These constraints are applied during both validation and runtime.

4. **Runtime Predicate Evaluator**: Located in [predicateEvaluator.ts](./src/predicateEvaluator.ts), this component evaluates predicates that can be checked during execution, such as file existence, content matching, and logical conditions.

5. **Prompts**: The package includes prompt construction files like [planPrompt.ts](./src/prompts/planPrompt.ts) and [systemPrompt.ts](./src/prompts/systemPrompt.ts), which help generate structured prompts for planning agents and autonomous software engineer agents.

## How to extend

To extend the `validation` package, follow these steps:

1. **Understand the existing structure**: Review the key files and their responsibilities to identify where your changes fit.
2. **Modify the AgentPlan DSL**: If you need to extend the schema for agent plans, update [specSchema.ts](./src/specSchema.ts) to include new types, structures, or constraints.
3. **Enhance validation logic**: To add new validation passes or improve existing ones, modify [planValidator.ts](./src/planValidator.ts). Ensure that your changes align with the existing validation phases.
4. **Update policy enforcement**: If new organizational policies are required, extend [orgPolicy.ts](./src/orgPolicy.ts) to include additional constraints or rules.
5. **Expand predicate evaluation**: To support new runtime predicates, enhance [predicateEvaluator.ts](./src/predicateEvaluator.ts) with the necessary logic.
6. **Adjust prompts**: If new prompts are needed for agents, update or create new prompt files in the `prompts` directory.

When making changes, follow the established patterns in the codebase and ensure that your modifications are thoroughly tested. Use the existing test suite as a reference and add new tests as needed to validate your changes.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter validation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
