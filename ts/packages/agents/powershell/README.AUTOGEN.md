<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8d57030d6f9e6533f13a242bc4f02a06b38dd22223a9d86ba0e1abff7ad08890 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# powershell-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `powershell-typeagent` package is a TypeAgent application agent designed to create, manage, and execute PowerShell workflows. It provides a set of reusable PowerShell scripts derived from reasoning traces, enabling automation of system, file, process, and network operations. This package integrates with other TypeAgent components to support a wide range of actions and workflows.

## What it does

The `powershell-typeagent` package enables the execution of PowerShell scripts and workflows through a set of predefined actions. These actions are grouped into several categories:

- **PowerShell Flow Management**: Actions like `listPowerShellFlows`, `deletePowerShellFlow`, and `importPowerShellFlow` allow users to manage PowerShell workflows, including listing available flows, deleting existing ones, and importing new scripts.
- **File System Operations**: Actions such as `listFiles`, `readFile`, `writeFile`, and `deleteFile` provide functionality for interacting with the file system.
- **Process Management**: Actions like `listProcesses`, `startProcess`, and `stopProcess` enable users to manage system processes.
- **System Information Retrieval**: Actions such as `getDiskUsage`, `getUptime`, and `getEnvironmentVariables` allow users to query system-level information.
- **Data Manipulation**: Actions like `readJson`, `writeJson`, `readCsv`, `writeCsv`, and `filterCsv` provide tools for working with structured data formats.
- **Archive Management**: Actions such as `compress` and `expand` allow users to create and extract compressed files.

The package also includes features like script analysis using the Claude AI model and sandboxed execution of PowerShell scripts to ensure security and control over the execution environment.

## Setup

To set up the `powershell-typeagent` package, you need to configure the following environment variable:

- `TYPEAGENT_NO_SAMPLES`: This variable determines whether sample data is included in the agent's responses. Set it to `true` to disable sample data or `false` to enable it.

Ensure that this environment variable is defined in your environment before running the agent. If additional setup steps are required, refer to the hand-written README for more details.

## Key Files

The `powershell-typeagent` package is organized into several key files, each responsible for specific functionality:

- **[manifest.json](./src/manifest.json)**: Defines the agent's capabilities, including the core flow management actions and sub-action manifests for file operations, process management, and system information.
- **[powershellSchema.agr](./src/powershellSchema.agr)**: Contains the grammar rules for PowerShell actions, defining how different actions are parsed and executed.
- **[allActionsSchema.ts](./src/schema/allActionsSchema.ts)**: Aggregates all action schemas, providing a centralized definition of the agent's capabilities.
- **[actionHandler.mts](./src/actionHandler.mts)**: Implements the logic for handling various PowerShell actions, including script execution, flow management, and file system interactions.
- **[scriptAnalyzer.mts](./src/analysis/scriptAnalyzer.mts)**: Provides functionality for analyzing PowerShell scripts using the Claude AI model, ensuring scripts are optimized and secure.
- **[powershellRunner.mts](./src/execution/powershellRunner.mts)**: Handles the execution of PowerShell scripts, including sandboxing, parameter management, and output handling.
- **Namespace Schemas**: The `./src/namespaces/` directory contains additional schema files for specific namespaces, such as `archives`, `data`, `files`, `network`, `processes`, `services`, and `system`. These define actions for specialized operations like file compression, data manipulation, and network interactions.

## How to extend

To extend the functionality of the `powershell-typeagent` package, follow these steps:

1. **Define New Actions**:

   - Add new actions to the appropriate schema file, such as [powershellSchema.agr](./src/powershellSchema.agr) or one of the namespace-specific schema files in the `./src/namespaces/` directory.
   - Specify the action name, parameters, and grammar rules for parsing the action.

2. **Implement Action Handlers**:

   - Open the [actionHandler.mts](./src/actionHandler.mts) file.
   - Add the logic for handling the new actions. Use existing handlers as a reference for implementing the required functionality.

3. **Update the Manifest**:

   - Modify the [manifest.json](./src/manifest.json) file to include the new actions. Provide a description and ensure the action is properly registered in the manifest.

4. **Test the Implementation**:

   - Write unit tests for the new actions to verify their functionality. Ensure that the tests cover various scenarios, including edge cases.
   - Run the tests to confirm that the new actions work as expected.

5. **Integrate with Other Components**:
   - If the new actions interact with other TypeAgent components, ensure proper integration and compatibility. Update any necessary dependencies or configurations.

By following these steps, you can extend the `powershell-typeagent` package to support additional PowerShell actions and workflows. For more details, refer to the existing codebase and the hand-written README.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/manifest.json](./src/manifest.json)
- `./agent/handlers` → `./dist/actionHandler.mjs` _(not found on disk)_
- `./recipe` → `./dist/types/scriptRecipe.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-flows](../../../packages/agent-flows/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

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
- _…and 15 more under `./src/`._

### Agent surface

- Manifest: [./src/manifest.json](./src/manifest.json)
- Grammar: [./src/powershellSchema.agr](./src/powershellSchema.agr)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_NO_SAMPLES`

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter powershell-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
