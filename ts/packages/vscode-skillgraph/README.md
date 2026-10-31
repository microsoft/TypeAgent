# Skill Graph for VS Code

Checks Agent Skills (`SKILL.md` and the docs and scripts they reference) as you type. It uses the `@typeagent/skillgraph` language server.

- Diagnostics: broken links and anchors, unknown `skill://` names, missing scripts, unknown subcommands and flags.
- Hover on a command or link to see its spec and token count.
- Go to definition and find references on links, `skill://` names, and scripts.

## Skill folders

The server checks `.agents/skills`, `.claude/skills`, and `.github/skills` at the repo root. To add other folders, create `.skillgraphrc.json`:

```json
{
  "roots": ["src/**/skills"],
  "rules": { "orphan": "off" }
}
```

## Install

```sh
cd ts/packages/vscode-skillgraph
pnpm run build
pnpm run deploy:local
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
