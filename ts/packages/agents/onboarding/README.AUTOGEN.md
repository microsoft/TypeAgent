<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d3716bc7cc0306c068825be0148130443972fd584cd6f03e90dd25aca349c5c0 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# onboarding-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The onboarding-agent is a TypeAgent application agent designed to automate the integration of new applications and APIs into the TypeAgent ecosystem. It manages the end-to-end onboarding process, breaking it down into seven distinct phases, each handled by a sub-agent. This agent is particularly useful for AI orchestrators like Claude Code and GitHub Copilot, which can drive the onboarding process via TypeAgent's MCP interface.

## What it does

The onboarding-agent supports the following actions:

- `startOnboarding`: Initiates the onboarding process for a new integration.
- `resumeOnboarding`: Resumes an in-progress onboarding process from a specified phase.
- `getOnboardingStatus`: Retrieves the current status of an ongoing integration.
- `listIntegrations`: Lists all integrations with their statuses.

These actions enable the automation of integrating new applications by crawling documentation, generating sample phrases, creating TypeScript schemas, generating grammar files, scaffolding agent infrastructure, running tests, and packaging the final agent.

## Setup

To set up the onboarding-agent, you need to configure the `TYPEAGENT_UIA_HELPER` environment variable. This variable is essential for the UI Automation crawling feature, which is experimental and used for discovering actions in Windows desktop applications.

For detailed setup instructions, including how to obtain the value for `TYPEAGENT_UIA_HELPER`, refer to the hand-written README.

## Key Files

The onboarding-agent is structured into several key components:

- **Manifest**: [onboardingManifest.json](./src/onboardingManifest.json) defines the agent's metadata and schema.
- **Schema**: [onboardingSchema.ts](./src/onboardingSchema.ts) outlines the actions and their parameters.
- **Grammar**: [onboardingSchema.agr](./src/onboardingSchema.agr) contains the grammar rules for parsing user inputs.
- **Handler**: [onboardingActionHandler.ts](./src/onboardingActionHandler.ts) implements the logic for handling actions.
- **Discovery**: [discoveryHandler.ts](./src/discovery/discoveryHandler.ts) manages the discovery phase, crawling documentation or parsing OpenAPI specs.
- **Phrase Generation**: [grammarGenHandler.ts](./src/grammarGen/grammarGenHandler.ts) generates natural language phrases for actions.
- **Schema Generation**: [schemaGenHandler.ts](./src/schemaGen/schemaGenHandler.ts) creates TypeScript action schemas.
- **Scaffolding**: [scaffolderHandler.ts](./src/scaffolder/scaffolderHandler.ts) stamps out the agent package infrastructure.
- **Testing**: [testingHandler.ts](./src/testing/testingHandler.ts) generates and runs test cases.
- **Packaging**: [packagingHandler.ts](./src/packaging/packagingHandler.ts) packages the agent for distribution.

## How to extend

To extend the onboarding-agent, follow these steps:

1. **Open the schema file**: Start with [onboardingSchema.ts](./src/onboardingSchema.ts) to understand the existing actions and their parameters.
2. **Add new actions**: Define new actions in the schema file, specifying their names and parameters.
3. **Update the grammar**: Modify [onboardingSchema.agr](./src/onboardingSchema.agr) to include grammar rules for the new actions.
4. **Implement handlers**: Create or update handler functions in [onboardingActionHandler.ts](./src/onboardingActionHandler.ts) to process the new actions.
5. **Test your changes**: Write tests to validate the new actions and ensure they work as expected.

By following these steps, you can add new capabilities to the onboarding-agent, enabling it to handle additional types of integrations or improve its existing functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/onboardingManifest.json](./src/onboardingManifest.json)
- `./agent/handlers` → [./dist/onboardingActionHandler.js](./dist/onboardingActionHandler.js)
- `./uiCapture` → [./dist/uiCapture/index.js](./dist/uiCapture/index.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [aiclient](../../../packages/aiclient/README.md)
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
- _…and 59 more under `./src/`._

### Agent surface

- Manifest: [./src/onboardingManifest.json](./src/onboardingManifest.json)
- Schema: [./src/onboardingSchema.ts](./src/onboardingSchema.ts)
- Grammar: [./src/onboardingSchema.agr](./src/onboardingSchema.agr)
- Handler: [./src/onboardingActionHandler.ts](./src/onboardingActionHandler.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_UIA_HELPER`

### Actions

_4 actions implemented by this agent, parsed deterministically from `./src/onboardingSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says     | Action                                               |
| ------------- | ---------------------------------------------------- |
| _(no sample)_ | `startOnboarding` → `{ "integrationName": "…" }`     |
| _(no sample)_ | `resumeOnboarding` → `{ "integrationName": "…" }`    |
| _(no sample)_ | `getOnboardingStatus` → `{ "integrationName": "…" }` |
| _(no sample)_ | `listIntegrations`                                   |

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.509Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter onboarding-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
