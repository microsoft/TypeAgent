# Workflow DSL — VS Code extension

VS Code language support for `.wf` workflow files: syntax highlighting,
language configuration, and a client that launches the
[`workflow-lsp`](../lsp/README.md) server.

This is **Phase 0** scaffolding. Diagnostics, hover, completion, etc.
arrive in later phases per
`ts/docs/design/workflowSystem/editor/lsp-plan.md`.

## Build

```sh
pnpm --filter workflow-vscode build
```

`esbuild.mjs` produces:

- `dist/extension.js` &mdash; the extension entry point.
- `dist/server.js` &mdash; the bundled language server (the
  extension launches it as a Node IPC child).

## Packaging

```sh
pnpm --filter workflow-vscode package
```

Produces `dist-pub/workflow-vscode.vsix`, installable via
`code --install-extension`.
