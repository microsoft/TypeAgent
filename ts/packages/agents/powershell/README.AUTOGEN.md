<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=34a99469cadb9b87b44370bb6211a03c5035082ed6c3e0a98fa375089ed92030 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/powershell-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `powershell-typeagent` package is a TypeAgent application agent designed to manage and execute PowerShell workflows. It provides a collection of reusable PowerShell scripts derived from reasoning traces, enabling automation of tasks such as file management, process control, system monitoring, and data manipulation. This package integrates with other TypeAgent components to support a wide range of actions and workflows.

## What it does

The `powershell-typeagent` package provides a structured set of actions for interacting with PowerShell scripts and performing system-level operations. These actions are grouped into several functional categories:

- **PowerShell Workflow Management**: Actions like `listPowerShellFlows`, `deletePowerShellFlow`, and `importPowerShellFlow` allow users to manage PowerShell workflows. These actions enable listing available workflows, deleting existing ones, and importing new PowerShell scripts for execution.

- **File System Operations**: Actions such as `listFiles`, `readFile`, `writeFile`, and `deleteFile` provide capabilities for interacting with the file system, including reading, writing, and managing files.

- **Process Management**: Actions like `listProcesses`, `startProcess`, and `stopProcess` enable users to manage system processes, including starting and stopping them.

- **System Information Retrieval**: Actions such as `getDiskUsage`, `getUptime`, and `getEnvironmentVariables` allow users to query and retrieve system-level information.

- **Data Manipulation**: Includes actions like `readJson`, `writeJson`, `readCsv`, `writeCsv`, and `filterCsv` for working with structured data formats such as JSON and CSV.

- **Archive Management**: Actions like `compress` and `expand` allow users to create and extract compressed files.

Import analysis uses a model to extract recipe metadata while preserving the original script content. Analysis does not certify safety or authorize execution. Dynamic flows execute only after trusted user authorization, with TypeAgent's current Windows user privileges and subject to operating-system policy. This is not an arbitrary-code sandbox.

## Execution authorization

The goal is to keep useful PowerShell scripts available without allowing the agent to execute them silently. Approved code can use Git, native programs, installed modules, .NET, files and networking under the current user's OS rights. The approved-local path does not use AppContainer, forced ConstrainedLanguage, a command allowlist or a one-process limit.

Before execution, a dedicated trusted approval interface shows a summary and offers **Review script and details** for the full root script, arguments and execution context. Cancel is the default. Opening the full review is optional; TypeAgent requires authorization, not proof that every line was read. Missing approval, cancellation or an unavailable broker prevents execution. Model responses and recipe fields cannot grant approval.

Only direct-user calls can remember an exact invocation for the current session and connection. Reasoning calls, tests, drafts and repairs require fresh consent. SHA-256 and invocation checks bind authorization to the code, definition, arguments, working directory and timeout. Changing these inputs requires new authorization; restarting or using `@powershell revoke` clears remembered approvals.

The broker retains private request transport, bounded output, timeouts and cleanup of its owned process tree. These are execution-management controls, not containment of approved code. Root-script hashes do not verify every loaded file, module or executable, and approval does not establish that code is harmless. Reviewed built-in actions and separate shell/MCP tools have their own policies. The restricted broker protocol remains for compatibility, not as a selectable flow execution mode.

## Setup

Dynamic execution requires Windows, the packaged execution broker and an interactive client that supports trusted security approval. No execution feature flags are required. The obsolete `powershell.dynamicExecution.enabled` and `powershell.brokerExecution.enabled` settings are ignored, including explicit false values. Removing these settings makes execution available for approval, not automatically approved. See the hand-written README for the execution contract and client behavior.

## Key Files

The `powershell-typeagent` package is organized into several key files, each with a specific role:

- **[manifest.json](./src/manifest.json)**: Defines the agent's capabilities, including core actions for managing PowerShell workflows and sub-action manifests for file operations, process management, and system information.

- **[powershellSchema.agr](./src/powershellSchema.agr)**: Contains grammar rules for PowerShell actions, specifying how different actions are parsed and executed.

- **[allActionsSchema.ts](./src/schema/allActionsSchema.ts)**: Serves as a centralized repository for all action schemas, defining the full range of the agent's capabilities.

- **[actionHandler.mts](./src/actionHandler.mts)**: Implements the logic for handling various PowerShell actions, including script execution, workflow management, and file system interactions.

- **[scriptAnalyzer.mts](./src/analysis/scriptAnalyzer.mts)**: Extracts recipe metadata from imported scripts and rejects analysis that changes their content. It does not assess script safety or grant execution approval.

- **[powershellRunner.mts](./src/execution/powershellRunner.mts)**: Requires authorization for dynamic flows, checks the approved snapshot immediately before launch, and delegates execution to the Windows broker. Reviewed built-in actions use a separate path.

- **[scriptApproval.mts](./src/execution/scriptApproval.mts)**: Owns session-local approval records, exact-invocation checks, single-use launch permits, script review and revocation.

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
- `./agent/handlers` → `./dist/actionHandler.mjs` _(generated by the package build)_
- `./recipe` → `./dist/types/scriptRecipe.js` _(generated by the package build)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-flows](../../../packages/agent-flows/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)

External: `debug`

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
- _…and 28 more under `./src/`._

### Agent surface

- Manifest: [./src/manifest.json](./src/manifest.json)
- Grammar: [./src/powershellSchema.agr](./src/powershellSchema.agr)

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_NO_SAMPLES`
- `TYPEAGENT_POWERSHELL_BROKER`

---

_Auto-generated against commit `b788032289fd1cc6a2236a343460079b3bb3cf9a` on `2026-10-19T17:39:22.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/powershell-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
