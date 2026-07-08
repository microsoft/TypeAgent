<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=dff02fb5c9533ae5aff06886f4878724c48e2ae4bd41f8f66d16d0028bf713d3 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# github-cli-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `github-cli-agent` is a TypeAgent application agent that integrates with the GitHub CLI (`gh`) to provide programmatic access to a wide range of GitHub functionalities. It enables users to manage repositories, issues, pull requests, workflows, and more through natural language commands mapped to CLI actions.

## What it does

This agent acts as a bridge between natural language inputs and the GitHub CLI, supporting 64 distinct actions across various categories:

- **Authentication**: Actions like `authLogin`, `authLogout`, and `authStatus` allow users to manage their GitHub authentication state.
- **Issues**: Includes actions such as `issueCreate`, `issueClose`, `issueDelete`, `issueReopen`, `issueList`, and `issueView` for comprehensive issue management.
- **Pull Requests**: Actions like `prCreate`, `prClose`, `prMerge`, `prList`, `prView`, and `prCheckout` facilitate pull request workflows.
- **Repositories**: Manage repositories with actions such as `repoCreate`, `repoClone`, `repoDelete`, `repoView`, `repoFork`, `starRepo`, and `searchRepos`.
- **Codespaces**: Create, delete, and list codespaces using `codespaceCreate`, `codespaceDelete`, and `codespaceList`.
- **Gists**: Manage gists with `gistCreate`, `gistDelete`, and `gistList`.
- **Projects**: Use `projectCreate`, `projectDelete`, and `projectList` to manage GitHub projects.
- **Releases**: Handle releases with `releaseCreate`, `releaseDelete`, and `releaseList`.
- **Organizations**: View and list organizations using `orgView` and `orgList`.
- **Dependabot**: List security alerts with `dependabotAlerts`.
- **Workflows**: View workflow runs and details using `workflowView` and `runView`.
- **Miscellaneous**: Includes actions like `cacheList`, `cacheDelete`, `configSet`, `sshKeyAdd`, and `statusPrint`.

The agent also supports advanced features like color-coded output for Dependabot alerts, clickable hyperlinks in listings, and friendly confirmation messages for mutation actions.

## Setup

To use the `github-cli-agent`, ensure the following prerequisites are met:

1. **Install the GitHub CLI**: Download and install the GitHub CLI from `https://cli.github.com/`. Ensure it is available in your system's `PATH`.
2. **Authenticate with GitHub**: Run `gh auth login` to authenticate with your GitHub account.

The agent performs a `gh auth status` readiness check at startup and before executing any action. If the CLI is not installed or the user is not authenticated, the dispatcher will provide instructions to resolve the issue. After addressing any issues, run `@config agent refresh github-cli` to re-probe the environment.

## Key Files

The `github-cli-agent` is organized into several key files, each responsible for a specific aspect of the agent's functionality:

- **[github-cliManifest.json](./src/github-cliManifest.json)**: Defines the agent's metadata, including its description, emoji, and schema details.
- **[github-cliSchema.ts](./src/github-cliSchema.ts)**: Specifies the types and parameters for all supported actions.
- **[github-cliSchema.agr](./src/github-cliSchema.agr)**: Maps natural language inputs to specific actions and parameters.
- **[github-cliActionHandler.ts](./src/github-cliActionHandler.ts)**: Implements the logic for executing actions using the GitHub CLI.
- **[setup.ts](./src/setup.ts)**: Handles installation and readiness checks for the GitHub CLI, including platform-specific setup logic.

These files work together to define, interpret, and execute the agent's actions.

## How to extend

To add new functionality to the `github-cli-agent`, follow these steps:

1. **Define the new action**:

   - Add the action type and parameters to [github-cliSchema.ts](./src/github-cliSchema.ts).
   - Map natural language inputs to the action in [github-cliSchema.agr](./src/github-cliSchema.agr).

2. **Implement the action logic**:

   - Add the execution logic for the new action in [github-cliActionHandler.ts](./src/github-cliActionHandler.ts). Use the `execFileAsync` utility to invoke the GitHub CLI.

3. **Update the manifest**:

   - Ensure the new action is included in the schema details in [github-cliManifest.json](./src/github-cliManifest.json).

4. **Test the new action**:

   - Write unit tests to validate the new action's behavior.
   - Use the TypeAgent testing framework to run the tests and ensure the action integrates correctly.

5. **Document the action**:
   - Update the grammar file ([github-cliSchema.agr](./src/github-cliSchema.agr)) with sample utterances for the new action.
   - Verify that the deterministic documentation generation process includes the new action.

By following these steps, you can extend the `github-cli-agent` to support additional GitHub CLI commands or custom workflows.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/github-cliManifest.json](./src/github-cliManifest.json)
- `./agent/handlers` → `./dist/github-cliActionHandler.js` _(not found on disk)_

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter github-cli-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
