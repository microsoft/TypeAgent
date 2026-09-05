# GitHub CLI Agent

🐙 A TypeAgent agent for interacting with GitHub via the [GitHub CLI (`gh`)](https://cli.github.com/).

## Prerequisites

- [GitHub CLI](https://cli.github.com/) installed and on your `PATH`
- Authenticated via `gh auth login`

The agent runs a `gh auth status` readiness probe at startup and pre-flights it before every action — if `gh` isn't installed or you're not logged in, the dispatcher surfaces the fix (install link or `gh auth login`) instead of failing per-action. After fixing, run `@config agent refresh github-cli` to re-probe. There's no automated `setup` hook (login is interactive and must run in a terminal).

## Supported Actions

| Category           | Actions                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Auth**           | Login, logout, check status                                                                                       |
| **Issues**         | Create, close, reopen, list, view, browse                                                                         |
| **Pull Requests**  | Create (including draft), close, merge, list, view, checkout, browse                                              |
| **PR diagnostics** | List a PR's changed files (optionally with diff excerpts); explain failing checks with GitHub's error annotations |
| **Repos**          | Create, clone, delete, view (with field-specific queries like stars/forks), fork, star/unstar, browse             |
| **Search**         | Search repositories by keyword                                                                                    |
| **Status**         | Dashboard summary of notifications, PRs, and issues                                                               |
| **Contributors**   | Top N contributors for a repo                                                                                     |
| **Dependabot**     | List alerts with severity/state filters                                                                           |
| **Workflows**      | View workflow runs and workflow details                                                                           |
| **Other**          | Codespaces, gists, releases, projects, labels, secrets, SSH keys, config, orgs                                    |

## Example Phrases

```
show my GitHub status
list open PRs in microsoft/TypeAgent
how many stars does microsoft/TypeAgent have
show top 10 contributors for microsoft/TypeAgent
create issue "Fix login bug" in microsoft/TypeAgent
close issue 42 in microsoft/TypeAgent
show files changed in PR 2196
show the diff for PR 2196
why is CI failing on PR 2196
why is https://github.com/cli/cli/pull/9000 failing
open a draft PR for my-feature branch
show newest 5 dependabot alerts in microsoft/TypeAgent
fork microsoft/TypeAgent
star microsoft/TypeAgent
```

## Local merge conflict resolution

Say `resolve merge conflicts` or `resolve merge conflicts from main` to merge
the source branch into the currently checked-out local branch. The default
source is the remote's default branch, falling back to an existing `main` or
`master`. This action does not check out another branch or push.

Clean merges are committed locally. For conflicts, Reasoning uses its native
file and terminal tools in the repository root to inspect, resolve, and stage
only the conflicted paths. No connected editor extension is required. The
dispatcher then runs a separate completion action that verifies the index and
creates the merge commit; a model's text response alone is not completion.

If resolution fails or is cancelled, the merge remains in progress. Inspect
`git status` before continuing. Resolve and stage the listed files, then run
`completeMergeConflictResolution` with the same `repositoryRoot`, or explicitly
abort with `git merge --abort`. Do not start another merge on top of it.

## Output Formatting

- PR, issue, and repo listings include clickable **hyperlinks**
- `repo view` answers specific questions (e.g., "how many stars") with a distilled one-line response
- Status output uses **bold section headers** for readability
- Dependabot alerts are color-coded by severity (🔴 critical, 🟠 high, 🟡 medium, 🟢 low)
- Mutation actions (create, close, star, fork) return friendly emoji confirmation messages
- `prFiles` and `prFailedChecks` return typed structured data (`rawData`) alongside their display, and state explicitly when output was truncated, so an external MCP client can act on the result directly
- `prFiles` and `prFailedChecks` accept a pull request's web link in place of an `OWNER/REPO` slug, so a PR in another repository (or on a GitHub Enterprise host) can be diagnosed without leaving the current checkout

## Demo

Demo scripts are available for replay in the TypeAgent shell and CLI:

```bash
# Shell (interactive)
@demo github_cli

# CLI
npx agent-cli --demo demo/github_cli.txt
```

## Building

```bash
pnpm install
pnpm run build
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
