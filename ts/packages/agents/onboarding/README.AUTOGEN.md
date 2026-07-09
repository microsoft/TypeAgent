<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=e70a34de09e04d0701e2a11f057e8107bf406bb4ecff169a7fb214eb2f057f33 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# onboarding-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `onboarding-agent` is a TypeAgent application agent designed to automate the process of integrating new applications and APIs into the TypeAgent ecosystem. It organizes the onboarding workflow into seven distinct phases, each managed by a sub-agent, and produces artifacts at every step. These artifacts are stored in a structured workspace directory, enabling the process to be paused and resumed as needed. The agent is optimized for use with AI orchestrators like Claude Code and GitHub Copilot, which can drive the onboarding process via TypeAgent's MCP interface.

## What it does

The `onboarding-agent` facilitates the onboarding of new integrations by breaking the process into the following seven phases:

1. **Discovery**: Crawls documentation, parses OpenAPI specs, or analyzes CLI `--help` output to enumerate the API surface.
2. **Phrase Generation**: Generates natural language sample phrases for each discovered action.
3. **Schema Generation**: Creates TypeScript action schemas based on the discovered API surface.
4. **Grammar Generation**: Produces `.agr` grammar files from the generated schemas and phrases.
5. **Scaffolding**: Generates the agent package infrastructure, including handlers and configuration files.
6. **Testing**: Creates test cases and validates the generated artifacts through a phrase-to-action testing loop.
7. **Packaging**: Packages the completed agent for distribution and registration within the TypeAgent ecosystem.

The agent supports the following actions:

- `startOnboarding`: Initiates the onboarding process for a new integration, requiring an `integrationName` and optional parameters like `description` and `apiType`.
- `resumeOnboarding`: Resumes an in-progress onboarding process, optionally starting from a specific phase such as `discovery`, `schemaGen`, or `testing`.
- `getOnboardingStatus`: Retrieves the current status of an ongoing integration, including the current phase and progress.
- `listIntegrations`: Lists all integrations, optionally filtered by their status (e.g., `in-progress` or `complete`).

The onboarding process is designed to be iterative and interactive, with each phase requiring approval before proceeding to the next. This ensures that the generated artifacts are validated and refined at every step.

## Setup

To use the `onboarding-agent`, you need to configure the following environment variables:

- `TYPEAGENT_UIA_HELPER`: This is required for the experimental UI Automation crawling feature, which is used to discover actions in Windows desktop applications. Refer to the hand-written README for details on how to set this up.
- `__PORT_ENV__`: Specifies the port environment for the agent. Ensure this is set to the appropriate value for your environment.

Additionally, for optimal usage, it is recommended to set up TypeAgent as an MCP server. This allows AI clients like Claude Code or GitHub Copilot to communicate directly with the TypeAgent dispatcher. The hand-written README provides detailed instructions for this setup.

## Key Files

The `onboarding-agent` is organized into several key files and directories, each responsible for a specific aspect of the onboarding process:

- **[onboardingManifest.json](./src/onboardingManifest.json)**: Contains metadata about the agent, including its schema and sub-agent configurations.
- **[onboardingSchema.ts](./src/onboardingSchema.ts)**: Defines the actions supported by the agent, including their names, parameters, and types.
- **[onboardingSchema.agr](./src/onboardingSchema.agr)**: Contains grammar rules for parsing user inputs into actionable commands.
- **[onboardingActionHandler.ts](./src/onboardingActionHandler.ts)**: Implements the logic for handling the defined actions.

### Sub-agent Files

Each phase of the onboarding process is managed by a sub-agent with its own set of files:

- **Discovery Phase**:

  - [discoveryHandler.ts](./src/discovery/discoveryHandler.ts): Manages the discovery phase, including crawling documentation and parsing OpenAPI specs.
  - [discoverySchema.ts](./src/discovery/discoverySchema.ts): Defines the schema for discovery-related actions.
  - [discoverySchema.agr](./src/discovery/discoverySchema.agr): Contains grammar rules specific to the discovery phase.

- **Phrase Generation Phase**:

  - [grammarGenHandler.ts](./src/grammarGen/grammarGenHandler.ts): Handles the generation of natural language phrases for actions.
  - [grammarGenSchema.agr](./src/grammarGen/grammarGenSchema.agr): Defines grammar rules for phrase generation.

- **Schema Generation Phase**:

  - [schemaGenHandler.ts](./src/schemaGen/schemaGenHandler.ts): Generates TypeScript action schemas.

- **Scaffolding Phase**:

  - [scaffolderHandler.ts](./src/scaffolder/scaffolderHandler.ts): Creates the agent package infrastructure.

- **Testing Phase**:

  - [testingHandler.ts](./src/testing/testingHandler.ts): Generates and executes test cases for the onboarding process.

- **Packaging Phase**:
  - [packagingHandler.ts](./src/packaging/packagingHandler.ts): Packages the completed agent for deployment.

## How to extend

To extend the `onboarding-agent`, follow these steps:

1. **Review the existing schema**: Start by examining [onboardingSchema.ts](./src/onboardingSchema.ts) to understand the current actions and their parameters.
2. **Add new actions**: Define new actions in the schema file, specifying their names, parameters, and types.
3. **Update grammar rules**: Modify [onboardingSchema.agr](./src/onboardingSchema.agr) to include grammar rules for the new actions. This ensures that user inputs can be correctly parsed into the new actions.
4. **Implement action handlers**: Add or update handler functions in [onboardingActionHandler.ts](./src/onboardingActionHandler.ts) to define the logic for the new actions.
5. **Test your changes**: Use the testing framework provided in the onboarding-agent to validate the new functionality. Write test cases to ensure the new actions work as expected.

By following these steps, you can enhance the `onboarding-agent` to support additional integration scenarios or improve its existing capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/onboardingManifest.json](./src/onboardingManifest.json)
- `./agent/handlers` → `./dist/onboardingActionHandler.js` _(not found on disk)_
- `./uiCapture` → `./dist/uiCapture/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [dispatcher-node-providers](../../../packages/dispatcher/nodeProviders/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `debug`, `typechat`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- windowsclock-agent

### Files of interest

- [./src/onboardingActionHandler.ts](./src/onboardingActionHandler.ts)
- [./src/onboardingManifest.json](./src/onboardingManifest.json)
- [./src/onboardingSchema.agr](./src/onboardingSchema.agr)
- [./src/onboardingSchema.ts](./src/onboardingSchema.ts)
- [./src/discovery/discoveryHandler.ts](./src/discovery/discoveryHandler.ts)
- [./src/discovery/discoveryLlmSchema.ts](./src/discovery/discoveryLlmSchema.ts)
- [./src/discovery/discoverySchema.agr](./src/discovery/discoverySchema.agr)
- [./src/discovery/discoverySchema.ts](./src/discovery/discoverySchema.ts)
- [./src/grammarGen/grammarGenHandler.ts](./src/grammarGen/grammarGenHandler.ts)
- [./src/grammarGen/grammarGenSchema.agr](./src/grammarGen/grammarGenSchema.agr)
- _…and 84 more under `./src/`._

### Agent surface

- Manifest: [./src/onboardingManifest.json](./src/onboardingManifest.json)
- Schema: [./src/onboardingSchema.ts](./src/onboardingSchema.ts)
- Grammar: [./src/onboardingSchema.agr](./src/onboardingSchema.agr)
- Handler: [./src/onboardingActionHandler.ts](./src/onboardingActionHandler.ts)

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_UIA_HELPER`
- `__PORT_ENV__`

### Actions

_4 actions implemented by this agent, parsed deterministically from `./src/onboardingSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says     | Action                                               |
| ------------- | ---------------------------------------------------- |
| _(no sample)_ | `startOnboarding` → `{ "integrationName": "…" }`     |
| _(no sample)_ | `resumeOnboarding` → `{ "integrationName": "…" }`    |
| _(no sample)_ | `getOnboardingStatus` → `{ "integrationName": "…" }` |
| _(no sample)_ | `listIntegrations`                                   |

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter onboarding-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
