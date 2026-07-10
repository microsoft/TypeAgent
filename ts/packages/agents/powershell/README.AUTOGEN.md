<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8d57030d6f9e6533f13a242bc4f02a06b38dd22223a9d86ba0e1abff7ad08890 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# powershell-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `powershell-typeagent` package is a TypeAgent application agent that facilitates the creation, management, and execution of PowerShell workflows. It provides a collection of reusable PowerShell scripts derived from reasoning traces, enabling automation of tasks such as file management, process control, system monitoring, and data manipulation. This package integrates with other TypeAgent components to support a wide range of actions and workflows.

## What it does

The `powershell-typeagent` package provides a comprehensive set of actions for interacting with PowerShell scripts and managing system-level operations. These actions are organized into several functional categories:

- **PowerShell Workflow Management**: Includes actions such as `listPowerShellFlows`, `deletePowerShellFlow`, and `importPowerShellFlow` to manage PowerShell workflows. These actions allow users to list available workflows, delete existing ones, and import new PowerShell scripts for execution.
- **File System Operations**: Actions like `listFiles`, `readFile`, `writeFile`, and `deleteFile` enable users to interact with the file system, including reading, writing, and managing files.

- **Process Management**: Actions such as `listProcesses`, `startProcess`, and `stopProcess` provide the ability to manage system processes, including starting and stopping processes.

- **System Information Retrieval**: Actions like `getDiskUsage`, `getUptime`, and `getEnvironmentVariables` allow users to query and retrieve system-level information.

- **Data Manipulation**: Includes actions such as `readJson`, `writeJson`, `readCsv`, `writeCsv`, and `filterCsv` for working with structured data formats like JSON and CSV.

- **Archive Management**: Actions such as `compress` and `expand` allow users to create and extract compressed files.

The package also includes features for analyzing PowerShell scripts using the Claude AI model and executing scripts in a controlled, sandboxed environment to ensure security and proper resource management.

## Setup

To use the `powershell-typeagent` package, you need to configure the following environment variable:

- `TYPEAGENT_NO_SAMPLES`: This variable controls whether sample data is included in the agent's responses. Set it to `true` to disable sample data or `false` to enable it.

Ensure that this environment variable is set in your environment before running the agent. If additional setup steps are required, refer to the hand-written README for further details.

## Key Files

The `powershell-typeagent` package is structured into several key files, each serving a specific purpose:

- **[manifest.json](./src/manifest.json)**: Defines the agent's capabilities, including the core actions for managing PowerShell workflows and sub-action manifests for file operations, process management, and system information.

- **[powershellSchema.agr](./src/powershellSchema.agr)**: Contains the grammar rules for PowerShell actions, specifying how different actions are parsed and executed.

- **[allActionsSchema.ts](./src/schema/allActionsSchema.ts)**: Serves as a centralized repository for all action schemas, defining the full range of the agent's capabilities.

- **[actionHandler.mts](./src/actionHandler.mts)**: Implements the logic for handling various PowerShell actions, including script execution, workflow management, and file system interactions.

- **[scriptAnalyzer.mts](./src/analysis/scriptAnalyzer.mts)**: Provides functionality for analyzing PowerShell scripts using the Claude AI model, ensuring that scripts are optimized and secure.

- **[powershellRunner.mts](./src/execution/powershellRunner.mts)**: Manages the execution of PowerShell scripts, including sandboxing, parameter handling, and output processing.

- **Namespace Schemas**: The `./src/namespaces/` directory contains schema files for specific namespaces, such as `archives`, `data`, `files`, `network`, `processes`, `services`, and `system`. These schemas define actions for specialized operations like file compression, data manipulation, and network interactions.

## How to extend

To add new functionality to the `powershell-typeagent` package, follow these steps:

1. **Define New Actions**:

   - Add the new action definitions to the appropriate schema file, such as [powershellSchema.agr](./src/powershellSchema.agr) or one of the namespace-specific schema files in the `./src/namespaces/` directory.
   - Specify the action name, parameters, and grammar rules for parsing the action.

2. **Implement Action Handlers**:

   - Open the [actionHandler.mts](./src/actionHandler.mts) file.
   - Implement the logic for the new actions. Use existing handlers as a reference for structuring and implementing the new functionality.

3. **Update the Manifest**:

   - Add the new actions to the [manifest.json](./src/manifest.json) file. Provide a clear description and ensure the action is properly registered.

4. **Test the Implementation**:

   - Write unit tests for the new actions to verify their functionality. Ensure the tests cover a variety of scenarios, including edge cases.
   - Run the tests to confirm that the new actions work as intended.

5. **Integrate with Other Components**:
   - If the new actions interact with other TypeAgent components, ensure proper integration and compatibility. Update any necessary dependencies or configurations.

By following these steps, you can extend the `powershell-typeagent` package to support additional PowerShell actions and workflows. For further guidance, refer to the existing codebase and the hand-written README.

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

_Auto-generated against commit `463e6bf5c6f8eeaf9cc7512e33f3976761eece62` on `2026-07-10T09:05:05.791Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter powershell-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
