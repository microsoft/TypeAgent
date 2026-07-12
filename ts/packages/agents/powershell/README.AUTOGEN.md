<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8d57030d6f9e6533f13a242bc4f02a06b38dd22223a9d86ba0e1abff7ad08890 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# powershell-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `powershell-typeagent` package is a TypeAgent application agent designed to manage and execute PowerShell workflows. It provides a set of reusable PowerShell scripts derived from reasoning traces, enabling automation of tasks such as file management, process control, system monitoring, and data manipulation. This package integrates with other TypeAgent components and supports a wide range of actions and workflows, making it a versatile tool for system-level operations.

## What it does

The `powershell-typeagent` package organizes its functionality into several key categories, each represented by a set of actions:

- **PowerShell Workflow Management**: Actions like `listPowerShellFlows`, `deletePowerShellFlow`, and `importPowerShellFlow` allow users to manage PowerShell workflows. These actions enable listing available workflows, deleting existing ones, and importing new PowerShell scripts for execution.

- **File System Operations**: Actions such as `listFiles`, `readFile`, `writeFile`, and `deleteFile` provide capabilities for interacting with the file system, including reading, writing, and managing files.

- **Process Management**: Actions like `listProcesses`, `startProcess`, and `stopProcess` enable users to manage system processes, including starting and stopping them.

- **System Information Retrieval**: Actions such as `getDiskUsage`, `getUptime`, and `getEnvironmentVariables` allow users to query and retrieve system-level information.

- **Data Manipulation**: The package supports structured data operations with actions like `readJson`, `writeJson`, `readCsv`, `writeCsv`, and `filterCsv`.

- **Archive Management**: Actions such as `compress` and `expand` enable users to create and extract compressed files.

Additionally, the package includes features for analyzing PowerShell scripts using the Claude AI model and executing scripts in a controlled, sandboxed environment. This ensures secure and efficient script execution while providing insights into script optimization.

## Setup

To use the `powershell-typeagent` package, you need to configure the following environment variable:

- `TYPEAGENT_NO_SAMPLES`: This variable determines whether sample data is included in the agent's responses. Set it to `true` to disable sample data or `false` to enable it.

Ensure this environment variable is set in your environment before running the agent. If additional setup steps are required, refer to the hand-written README for further details.

## Key Files

The `powershell-typeagent` package is organized into several key files and directories, each with specific responsibilities:

- **[manifest.json](./src/manifest.json)**: Defines the agent's capabilities, including core actions for managing PowerShell workflows and sub-action manifests for file operations, process management, and system information.

- **[powershellSchema.agr](./src/powershellSchema.agr)**: Contains the grammar rules for PowerShell actions, specifying how different actions are parsed and executed.

- **[allActionsSchema.ts](./src/schema/allActionsSchema.ts)**: Serves as a centralized repository for all action schemas, defining the full range of the agent's capabilities.

- **[actionHandler.mts](./src/actionHandler.mts)**: Implements the logic for handling various PowerShell actions, including script execution, workflow management, and file system interactions.

- **[scriptAnalyzer.mts](./src/analysis/scriptAnalyzer.mts)**: Provides functionality for analyzing PowerShell scripts using the Claude AI model. This ensures that scripts are optimized and secure before execution.

- **[powershellRunner.mts](./src/execution/powershellRunner.mts)**: Manages the execution of PowerShell scripts, including sandboxing, parameter handling, and output processing.

- **Namespace Schemas**: The `./src/namespaces/` directory contains schema files for specific namespaces, such as:
  - **[archivesSchema.agr](./src/namespaces/archives/archivesSchema.agr)**: Defines actions for file compression and extraction.
  - **[dataSchema.agr](./src/namespaces/data/dataSchema.agr)**: Specifies actions for data manipulation, including JSON and CSV operations.
  - **[filesSchema.agr](./src/namespaces/files/filesSchema.agr)**: Handles file system operations.
  - **[processesSchema.agr](./src/namespaces/processes/processesSchema.agr)**: Manages system processes.
  - **[systemSchema.agr](./src/namespaces/system/systemSchema.agr)**: Provides actions for retrieving system-level information.

## How to extend

To extend the `powershell-typeagent` package with new functionality, follow these steps:

1. **Define New Actions**:

   - Add new action definitions to the appropriate schema file, such as [powershellSchema.agr](./src/powershellSchema.agr) or one of the namespace-specific schema files in the `./src/namespaces/` directory.
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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-12T08:45:00.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter powershell-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
