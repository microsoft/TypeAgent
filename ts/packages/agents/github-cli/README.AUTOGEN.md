<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=26353128cf30562c0712f3237a4e02f5c91883e2a0ffd13b777d0222b9ed4c38 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# github-cli-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `github-cli-agent` is a TypeAgent application agent designed to interact with GitHub through the GitHub CLI (`gh`). It enables users to perform a wide range of GitHub operations, such as managing repositories, issues, pull requests, workflows, and more, using natural language commands. By leveraging the GitHub CLI, this agent provides a streamlined interface for automating and simplifying common GitHub tasks.

## What it does

The `github-cli-agent` supports 65 actions, categorized into several functional areas:

- **Authentication**: Actions like `authLogin`, `authLogout`, and `authStatus` allow users to manage their GitHub authentication, including logging in, logging out, and checking the current authentication status.
- **Issues**: Manage GitHub issues with actions such as `issueCreate`, `issueClose`, `issueDelete`, `issueReopen`, `issueList`, and `issueView`. These actions enable users to create, modify, delete, and view issues across repositories.
- **Pull Requests**: Handle pull request workflows with actions like `prCreate`, `prClose`, `prMerge`, `prList`, `prView`, and `prCheckout`. These actions cover the entire lifecycle of pull requests, from creation to merging.
- **Repositories**: Perform repository-related tasks with actions such as `repoCreate`, `repoClone`, `repoDelete`, `repoView`, `repoFork`, `starRepo`, and `searchRepos`. These actions allow users to create, clone, delete, and explore repositories.
- **Codespaces**: Manage GitHub Codespaces with actions like `codespaceCreate`, `codespaceDelete`, and `codespaceList`.
- **Gists**: Create, delete, and list gists using `gistCreate`, `gistDelete`, and `gistList`.
- **Projects**: Manage GitHub projects with actions like `projectCreate`, `projectDelete`, and `projectList`.
- **Releases**: Handle releases with actions such as `releaseCreate`, `releaseDelete`, and `releaseList`.
- **Organizations**: View and list organizations using `orgView` and `orgList`.
- **Dependabot**: List security alerts with `dependabotAlerts`, filtered by severity or state.
- **Workflows**: View workflow runs and details using `workflowView` and `runView`.
- **Miscellaneous**: Includes actions like `cacheList`, `cacheDelete`, `configSet`, `sshKeyAdd`, and `statusPrint`.

The agent enhances the user experience by providing features such as clickable hyperlinks in listings, color-coded output for Dependabot alerts, and user-friendly confirmation messages for actions like creating or deleting resources.

## Setup

To use the `github-cli-agent`, follow these steps:

1. **Install the GitHub CLI**: Download and install the GitHub CLI from `https://cli.github.com/`. Ensure it is available in your system's `PATH`.
2. **Authenticate with GitHub**: Run `gh auth login` to authenticate with your GitHub account.

The agent performs a `gh auth status` readiness check at startup and before executing any action. If the CLI is not installed or the user is not authenticated, the dispatcher will provide instructions to resolve the issue. After addressing any issues, run `@config agent refresh github-cli` to re-probe the environment.

## Key Files

The `github-cli-agent` is structured around several key files that define its functionality:

- **[github-cliManifest.json](./src/github-cliManifest.json)**: Contains metadata about the agent, including its description, emoji, and schema details.
- **[github-cliSchema.ts](./src/github-cliSchema.ts)**: Defines the types and parameters for all supported actions.
- **[github-cliSchema.agr](./src/github-cliSchema.agr)**: Maps natural language inputs to specific actions and their parameters.
- **[github-cliActionHandler.ts](./src/github-cliActionHandler.ts)**: Implements the logic for executing actions by invoking the GitHub CLI.
- **[setup.ts](./src/setup.ts)**: Handles installation and readiness checks for the GitHub CLI, including platform-specific setup logic.

These files work together to define the agent's capabilities, interpret user inputs, and execute the corresponding GitHub CLI commands.

## How to extend

To add new functionality to the `github-cli-agent`, follow these steps:

1. **Define the new action**:

   - Add the action type and its parameters to [github-cliSchema.ts](./src/github-cliSchema.ts).
   - Update [github-cliSchema.agr](./src/github-cliSchema.agr) to map natural language inputs to the new action.

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

`./src/github-cliActionHandler.ts`, `./src/github-cliManifest.json`, `./src/github-cliSchema.agr`, …and 4 more under `./src/`.

### Agent surface

- Manifest: [./src/github-cliManifest.json](./src/github-cliManifest.json)
- Schema: [./src/github-cliSchema.ts](./src/github-cliSchema.ts)
- Grammar: [./src/github-cliSchema.agr](./src/github-cliSchema.agr)
- Handler: [./src/github-cliActionHandler.ts](./src/github-cliActionHandler.ts)

### Actions

_65 actions implemented by this agent, parsed deterministically from `./src/github-cliSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                                                            | Action                            |
| ------------------------------------------------------------------------------------ | --------------------------------- |
| _(no sample)_                                                                        | `authLogin`                       |
| _(no sample)_                                                                        | `authLogout`                      |
| _(no sample)_                                                                        | `authStatus`                      |
| _(no sample)_                                                                        | `browseRepo`                      |
| _(no sample)_                                                                        | `browseIssue`                     |
| _(no sample)_                                                                        | `browsePr`                        |
| _(no sample)_                                                                        | `codespaceCreate`                 |
| _(no sample)_                                                                        | `codespaceDelete`                 |
| _(no sample)_                                                                        | `codespaceList`                   |
| _(no sample)_                                                                        | `gistCreate`                      |
| _(no sample)_                                                                        | `gistDelete`                      |
| _(no sample)_                                                                        | `gistList`                        |
| _(no sample)_                                                                        | `issueCreate`                     |
| _(no sample)_                                                                        | `issueClose`                      |
| _Permanently delete a GitHub issue (uses `gh issue delete --yes`)._                  | `issueDelete` → `{ "number": 0 }` |
| _(no sample)_                                                                        | `issueReopen`                     |
| _(no sample)_                                                                        | `issueList`                       |
| _View / open a specific GitHub issue by number_                                      | `issueView`                       |
| _(no sample)_                                                                        | `orgList`                         |
| _(no sample)_                                                                        | `orgView`                         |
| _(no sample)_                                                                        | `prCreate`                        |
| _(no sample)_                                                                        | `prClose`                         |
| _(no sample)_                                                                        | `prMerge`                         |
| _List pull requests, optionally filtered by repo, state, label, author, or assignee_ | `prList`                          |
| _View / open a specific GitHub pull request by number_                               | `prView`                          |
| _(no sample)_                                                                        | `prCheckout`                      |
| _(no sample)_                                                                        | `prChecks` → `{ "number": 0 }`    |
| _(no sample)_                                                                        | `projectCreate`                   |
| _(no sample)_                                                                        | `projectDelete`                   |
| _(no sample)_                                                                        | `projectList`                     |
| _…and 35 more actions not shown (cap: 30)._                                          |                                   |

---

_Auto-generated against commit `defc71271dc68db47e0d376be7aa9f755da0ac91` on `2026-07-14T08:47:00.044Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter github-cli-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
