<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9739d92a27358d6979d24dd8154e3f07d978c54b221eabc0310c05aac8949f7b -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# github-cli-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `github-cli-agent` is a TypeAgent application agent designed to interact with GitHub via the GitHub CLI (`gh`). It provides a comprehensive set of actions to manage GitHub repositories, issues, pull requests, and other GitHub resources programmatically.

## What it does

The `github-cli-agent` supports a wide range of actions grouped into several categories:

- **Authentication**: `authLogin`, `authLogout`, `authStatus`
- **Issues**: `issueCreate`, `issueClose`, `issueDelete`, `issueReopen`, `issueList`, `issueView`, `browseIssue`
- **Pull Requests**: `prCreate`, `prClose`, `prMerge`, `prList`, `prView`, `prCheckout`, `prChecks`, `browsePr`
- **Repositories**: `repoCreate`, `repoClone`, `repoDelete`, `repoView`, `repoFork`, `starRepo`, `searchRepos`, `browseRepo`
- **Codespaces**: `codespaceCreate`, `codespaceDelete`, `codespaceList`
- **Gists**: `gistCreate`, `gistDelete`, `gistList`
- **Projects**: `projectCreate`, `projectDelete`, `projectList`
- **Releases**: `releaseCreate`, `releaseDelete`, `releaseList`
- **Organizations**: `orgList`, `orgView`
- **Dependabot**: `dependabotAlerts`
- **Workflows**: `workflowView`, `runView`
- **Miscellaneous**: `cacheList`, `cacheDelete`, `agentTaskRun`, `aliasSet`, `apiRequest`, `attestationCreate`, `completionGenerate`, `configSet`, `copilotRun`, `extensionInstall`, `gpgKeyAdd`, `labelCreate`, `issueAddLabel`, `licensesView`, `previewExecute`, `rulesetView`, `secretCreate`, `sshKeyAdd`, `statusPrint`, `myAssignedIssues`, `variableCreate`

These actions enable comprehensive management of GitHub resources, from authentication and repository management to issue tracking and workflow execution.

## Setup

To use the `github-cli-agent`, ensure the following prerequisites are met:

1. Install the GitHub CLI and ensure it is available in your system's `PATH`.
2. Authenticate via `gh auth login`.

The agent performs a `gh auth status` readiness check at startup and before every action. If the GitHub CLI is not installed or the user is not authenticated, the dispatcher will provide instructions to resolve the issue. After fixing any issues, run `@config agent refresh github-cli` to re-probe.

## Key Files

The `github-cli-agent` is structured into several key components:

- **Manifest**: The [github-cliManifest.json](./src/github-cliManifest.json) file defines the agent's metadata, including its description, emoji character, and schema details.
- **Schema**: The [github-cliSchema.ts](./src/github-cliSchema.ts) file outlines the types and parameters for each action supported by the agent.
- **Grammar**: The [github-cliSchema.agr](./src/github-cliSchema.agr) file specifies the natural language mappings for the actions.
- **Handler**: The [github-cliActionHandler.ts](./src/github-cliActionHandler.ts) file contains the logic for executing the actions using the GitHub CLI.
- **Setup**: The [setup.ts](./src/setup.ts) file manages the installation and readiness checks for the GitHub CLI.

## How to extend

To extend the `github-cli-agent`, follow these steps:

1. **Add a new action**:

   - Define the action type in [github-cliSchema.ts](./src/github-cliSchema.ts).
   - Add natural language mappings in [github-cliSchema.agr](./src/github-cliSchema.agr).
   - Implement the action logic in [github-cliActionHandler.ts](./src/github-cliActionHandler.ts).

2. **Update the manifest**:

   - Ensure the new action is included in the schema details in [github-cliManifest.json](./src/github-cliManifest.json).

3. **Test the new action**:
   - Write unit tests to validate the new action's functionality.
   - Run the tests using the TypeAgent testing framework.

By following these steps, you can add new capabilities to the `github-cli-agent` and ensure they are properly integrated and tested.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/github-cliManifest.json](./src/github-cliManifest.json)
- `./agent/handlers` → [./dist/github-cliActionHandler.js](./dist/github-cliActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/github-cliActionHandler.ts`, `./src/github-cliManifest.json`, `./src/github-cliSchema.agr`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/github-cliManifest.json](./src/github-cliManifest.json)
- Schema: [./src/github-cliSchema.ts](./src/github-cliSchema.ts)
- Grammar: [./src/github-cliSchema.agr](./src/github-cliSchema.agr)
- Handler: [./src/github-cliActionHandler.ts](./src/github-cliActionHandler.ts)

### Actions

_64 actions implemented by this agent, parsed deterministically from `./src/github-cliSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                                           | Action                            |
| ------------------------------------------------------------------- | --------------------------------- |
| _(no sample)_                                                       | `authLogin`                       |
| _(no sample)_                                                       | `authLogout`                      |
| _(no sample)_                                                       | `authStatus`                      |
| _(no sample)_                                                       | `browseRepo`                      |
| _(no sample)_                                                       | `browseIssue`                     |
| _(no sample)_                                                       | `browsePr`                        |
| _(no sample)_                                                       | `codespaceCreate`                 |
| _(no sample)_                                                       | `codespaceDelete`                 |
| _(no sample)_                                                       | `codespaceList`                   |
| _(no sample)_                                                       | `gistCreate`                      |
| _(no sample)_                                                       | `gistDelete`                      |
| _(no sample)_                                                       | `gistList`                        |
| _(no sample)_                                                       | `issueCreate`                     |
| _(no sample)_                                                       | `issueClose`                      |
| _Permanently delete a GitHub issue (uses `gh issue delete --yes`)._ | `issueDelete` → `{ "number": 0 }` |
| _(no sample)_                                                       | `issueReopen`                     |
| _(no sample)_                                                       | `issueList`                       |
| _View / open a specific GitHub issue by number_                     | `issueView`                       |
| _(no sample)_                                                       | `orgList`                         |
| _(no sample)_                                                       | `orgView`                         |
| _(no sample)_                                                       | `prCreate`                        |
| _(no sample)_                                                       | `prClose`                         |
| _(no sample)_                                                       | `prMerge`                         |
| _(no sample)_                                                       | `prList`                          |
| _View / open a specific GitHub pull request by number_              | `prView`                          |
| _(no sample)_                                                       | `prCheckout`                      |
| _(no sample)_                                                       | `prChecks` → `{ "number": 0 }`    |
| _(no sample)_                                                       | `projectCreate`                   |
| _(no sample)_                                                       | `projectDelete`                   |
| _(no sample)_                                                       | `projectList`                     |
| _…and 34 more actions not shown (cap: 30)._                         |                                   |

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter github-cli-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
