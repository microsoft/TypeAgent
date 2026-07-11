<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ca702e86bec4d3344d1b54887951e7aff94e01799193cefa823f6c4689a663e0 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# github-cli-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `github-cli-agent` is a TypeAgent application agent that integrates with the GitHub CLI (`gh`) to enable programmatic interaction with GitHub. It provides a wide range of actions for managing repositories, issues, pull requests, workflows, and other GitHub features through natural language commands. By leveraging the GitHub CLI, this agent simplifies the automation of common GitHub tasks and workflows.

## What it does

The `github-cli-agent` implements 64 actions, categorized into the following functional areas:

- **Authentication**: Actions like `authLogin`, `authLogout`, and `authStatus` allow users to manage their GitHub authentication, including logging in, logging out, and checking the current authentication status.
- **Issues**: Manage GitHub issues with actions such as `issueCreate`, `issueClose`, `issueDelete`, `issueReopen`, `issueList`, and `issueView`. These actions enable users to create, modify, delete, and view issues in repositories.
- **Pull Requests**: Handle pull request workflows with actions like `prCreate`, `prClose`, `prMerge`, `prList`, `prView`, and `prCheckout`. These actions support creating, reviewing, merging, and managing pull requests.
- **Repositories**: Perform repository-related tasks with actions such as `repoCreate`, `repoClone`, `repoDelete`, `repoView`, `repoFork`, `starRepo`, and `searchRepos`. These actions allow users to create, clone, delete, and explore repositories.
- **Codespaces**: Manage GitHub Codespaces with actions like `codespaceCreate`, `codespaceDelete`, and `codespaceList`.
- **Gists**: Create, delete, and list gists using `gistCreate`, `gistDelete`, and `gistList`.
- **Projects**: Manage GitHub projects with actions like `projectCreate`, `projectDelete`, and `projectList`.
- **Releases**: Handle releases with actions such as `releaseCreate`, `releaseDelete`, and `releaseList`.
- **Organizations**: View and list organizations using `orgView` and `orgList`.
- **Dependabot**: List security alerts with `dependabotAlerts`, filtered by severity or state.
- **Workflows**: View workflow runs and details using `workflowView` and `runView`.
- **Miscellaneous**: Includes actions like `cacheList`, `cacheDelete`, `configSet`, `sshKeyAdd`, and `statusPrint`.

The agent enhances usability with features like clickable hyperlinks in listings, color-coded output for Dependabot alerts, and user-friendly confirmation messages for actions like creating or deleting resources.

## Setup

To use the `github-cli-agent`, follow these setup steps:

1. **Install the GitHub CLI**: Download and install the GitHub CLI from `https://cli.github.com/`. Ensure it is available in your system's `PATH`.
2. **Authenticate with GitHub**: Run `gh auth login` to authenticate with your GitHub account.

The agent performs a `gh auth status` readiness check at startup and before executing any action. If the CLI is not installed or the user is not authenticated, the dispatcher will provide instructions to resolve the issue. After addressing any issues, run `@config agent refresh github-cli` to re-probe the environment.

## Key Files

The `github-cli-agent` is organized into several key files, each serving a specific role in the agent's functionality:

- **[github-cliManifest.json](./src/github-cliManifest.json)**: Defines metadata about the agent, including its description, emoji, and schema details.
- **[github-cliSchema.ts](./src/github-cliSchema.ts)**: Specifies the types and parameters for all supported actions.
- **[github-cliSchema.agr](./src/github-cliSchema.agr)**: Maps natural language inputs to specific actions and their parameters.
- **[github-cliActionHandler.ts](./src/github-cliActionHandler.ts)**: Implements the logic for executing actions by invoking the GitHub CLI.
- **[setup.ts](./src/setup.ts)**: Handles installation and readiness checks for the GitHub CLI, including platform-specific setup logic.

These files collectively define the agent's capabilities, interpret user inputs, and execute the corresponding GitHub CLI commands.

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

`./src/github-cliActionHandler.ts`, `./src/github-cliManifest.json`, `./src/github-cliSchema.agr`, …and 4 more under `./src/`.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter github-cli-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
