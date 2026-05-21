# Workflow DSL — VS Code extension

VS Code language support for `.wf` workflow files. Bundles a client
that launches [`workflow-lsp`](../lsp/README.md) as a child process
over Node IPC, and provides a `.wf` TextMate grammar, snippets, and an
icon theme.

## Features

- Activates on `.wf` files (language id `workflow`).
- Full LSP feature set served by `workflow-lsp` — see
  [`../lsp/README.md`](../lsp/README.md) for the capability table.
- Commands (Command Palette):
  - **Workflow: Preview IR** — compiles the active `.wf` file and
    opens the IR JSON in a side editor; refreshes on save.
  - **Workflow: Preview Graph** — opens a webview rendering the
    workflow graph extracted from the AST (parses on demand;
    refreshes on save).
  - **Workflow: Show Server Output** — reveals the language server
    output channel.
- Settings:
  - `workflow.trace.server` (`off` | `messages` | `verbose`) — trace
    JSON-RPC traffic between VS Code and the language server. Output
    lands in the **Workflow Language Server** output channel.

## Build

```sh
pnpm --filter workflow-vscode build
```

`esbuild.mjs` produces:

- `dist/extension.js` — the extension entry point (host bundle; `vscode`
  module remains external).
- `dist/server.js` — the bundled language server (the extension launches
  it as a Node IPC child).

## Packaging

```sh
pnpm --filter workflow-vscode package
```

Produces `dist-pub/workflow-vscode.vsix`, installable via
`code --install-extension`.

## End-to-end tests

The `@vscode/test-electron` harness lives under `src/test/`. It is
**not** runnable in the restricted dev container (no display server);
run on a developer workstation or CI runner with `xvfb-run`:

```sh
pnpm --filter workflow-vscode run test:e2e
# or with Xvfb on a headless CI host:
xvfb-run -a pnpm --filter workflow-vscode run test:e2e
```

See `scripts/extension-test.sh` and
[`ts/docs/design/workflowSystem/editor/lsp-decisions.md`](../../../docs/design/workflowSystem/editor/lsp-decisions.md).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
