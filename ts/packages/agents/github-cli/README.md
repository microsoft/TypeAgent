# GitHub CLI Agent

🐙 A TypeAgent agent for interacting with GitHub via the [GitHub CLI (`gh`)](https://cli.github.com/).

## Prerequisites

- [GitHub CLI](https://cli.github.com/) installed and on your `PATH`
- Authenticated via `gh auth login`

## Supported Actions

| Category          | Actions                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Auth**          | Login, logout, check status                                                                           |
| **Issues**        | Create, close, reopen, list, view, browse                                                             |
| **Pull Requests** | Create (including draft), close, merge, list, view, checkout, browse                                  |
| **Repos**         | Create, clone, delete, view (with field-specific queries like stars/forks), fork, star/unstar, browse |
| **Search**        | Search repositories by keyword                                                                        |
| **Status**        | Dashboard summary of notifications, PRs, and issues                                                   |
| **Contributors**  | Top N contributors for a repo                                                                         |
| **Dependabot**    | List alerts with severity/state filters                                                               |
| **Workflows**     | View workflow runs and workflow details                                                               |
| **Other**         | Codespaces, gists, releases, projects, labels, secrets, SSH keys, config, orgs                        |

## Example Phrases

```
show my GitHub status
list open PRs in microsoft/TypeAgent
how many stars does microsoft/TypeAgent have
show top 10 contributors for microsoft/TypeAgent
create issue "Fix login bug" in microsoft/TypeAgent
close issue 42 in microsoft/TypeAgent
open a draft PR for my-feature branch
show newest 5 dependabot alerts in microsoft/TypeAgent
fork microsoft/TypeAgent
star microsoft/TypeAgent
```

## Output Formatting

- PR, issue, and repo listings include clickable **hyperlinks**
- `repo view` answers specific questions (e.g., "how many stars") with a distilled one-line response
- Status output uses **bold section headers** for readability
- Dependabot alerts are color-coded by severity (🔴 critical, 🟠 high, 🟡 medium, 🟢 low)
- Mutation actions (create, close, star, fork) return friendly emoji confirmation messages

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
