# git-commit-story

Attaches the agent sessions that led to a commit to that commit. This package is
the scaffold: a CLI and a Copilot CLI plugin, with no recording logic yet.

```text
$ git-commit-story init        # or: git commit-story init
Registered Copilot plugin in .github/copilot/settings.local.json
```

| Entry point          | Purpose                                                   |
| -------------------- | --------------------------------------------------------- |
| `src/cli.ts`         | `git-commit-story` CLI; git runs it as `git commit-story` |
| `src/plugin/hook.ts` | Copilot CLI hook, run from `dist/plugin/hook.js`          |

`init` registers the plugin for the current repo only. It writes
`.github/copilot/settings.local.json`, which is personal and must not be
committed.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
