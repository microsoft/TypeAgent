<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=143fb58cf8e856dcd1cb296414d7e2c3400a897e43bcc4e50e2e34acbadc2db6 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# powershell-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `powershell-typeagent` package is a TypeAgent application agent designed to create and execute PowerShell workflows. It leverages reusable PowerShell scripts derived from reasoning traces to perform various system, file, process, and network operations.

## What it does

This package provides a set of actions for managing and executing PowerShell scripts. It includes actions for creating, listing, and deleting PowerShell flows (`listPowerShellFlows`, `deletePowerShellFlow`, `importPowerShellFlow`). Additionally, it supports file system operations (`listFiles`, `readFile`, `writeFile`, `deleteFile`), process management (`listProcesses`, `startProcess`, `stopProcess`), and system information retrieval (`getDiskUsage`, `getUptime`, `getEnvironmentVariables`). The package integrates with other TypeAgent components to facilitate these operations.

## Setup

The package requires the environment variable `TYPEAGENT_NO_SAMPLES`. This variable controls whether sample data is included in the agent's responses. To set up the package, ensure this environment variable is defined in your environment. For detailed setup instructions, see the hand-written README.

## Key Files

The package is structured into several key components:

- **Manifest**: The [manifest.json](./src/manifest.json) file defines the agent's capabilities, including the core flow management actions and sub-action manifests for file operations, process management, and system information.
- **Schema**: The [powershellSchema.agr](./src/powershellSchema.agr) file contains the grammar rules for PowerShell actions. It defines how different actions are parsed and executed.
- **Types**: The [scriptRecipe.ts](./src/types/scriptRecipe.ts) file defines the TypeScript interfaces for script recipes, parameters, grammar patterns, and sandbox policies.
- **Handlers**: The [actionHandler.mts](./src/actionHandler.mts) file implements the logic for handling various PowerShell actions. It includes functions for executing scripts, managing flows, and interacting with the file system.
- **Analysis**: The [scriptAnalyzer.mts](./src/analysis/scriptAnalyzer.mts) file provides functionality for analyzing PowerShell scripts using the Claude AI model.
- **Execution**: The [powershellRunner.mts](./src/execution/powershellRunner.mts) file handles the execution of PowerShell scripts, including sandboxing and parameter management.

## How to extend

To extend the `powershell-typeagent` package, follow these steps:

1. **Add new actions**: Define new actions in the appropriate schema file (e.g., [powershellSchema.agr](./src/powershellSchema.agr)). Ensure the action name and parameters are correctly specified.
2. **Implement handlers**: Update the [actionHandler.mts](./src/actionHandler.mts) file to include logic for the new actions. Implement the necessary functions to handle the action's execution.
3. **Update manifest**: Modify the [manifest.json](./src/manifest.json) file to include the new actions and their descriptions.
4. **Test**: Write tests for the new actions to ensure they work as expected. Run the tests to verify the implementation.

For a starting point, open the [actionHandler.mts](./src/actionHandler.mts) file and follow the existing patterns for implementing new actions.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/manifest.json](./src/manifest.json)
- `./agent/handlers` → [./dist/actionHandler.mjs](./dist/actionHandler.mjs)
- `./recipe` → [./dist/types/scriptRecipe.js](./dist/types/scriptRecipe.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-flows](../../../packages/agent-flows/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `debug`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

- [./src/manifest.json](./src/manifest.json)
- [./src/powershellSchema.agr](./src/powershellSchema.agr)
- [./src/namespaces/archives/archivesSchema.agr](./src/namespaces/archives/archivesSchema.agr)
- [./src/namespaces/data/dataSchema.agr](./src/namespaces/data/dataSchema.agr)
- [./src/namespaces/files/filesSchema.agr](./src/namespaces/files/filesSchema.agr)
- [./src/namespaces/network/networkSchema.agr](./src/namespaces/network/networkSchema.agr)
- [./src/namespaces/processes/processesSchema.agr](./src/namespaces/processes/processesSchema.agr)
- [./src/namespaces/services/servicesSchema.agr](./src/namespaces/services/servicesSchema.agr)
- [./src/namespaces/system/systemSchema.agr](./src/namespaces/system/systemSchema.agr)
- [./src/schema/allActionsSchema.ts](./src/schema/allActionsSchema.ts)
- _…and 14 more under `./src/`._

### Agent surface

- Manifest: [./src/manifest.json](./src/manifest.json)
- Grammar: [./src/powershellSchema.agr](./src/powershellSchema.agr)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_NO_SAMPLES`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:30.178Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter powershell-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
