# workflow-lsp

Language Server Protocol implementation for the workflow DSL (`.wf` files).

This is **Phase 0** scaffolding: the server starts, responds to
`initialize`, and accepts text-document sync notifications. Feature
handlers (diagnostics, hover, completion, ...) are added in later
phases per `ts/docs/design/workflowSystem/editor/lsp-plan.md`.

## Layout

- `src/index.ts` &mdash; bin entry; starts the server on stdio.
- `src/server.ts` &mdash; connection / capability wiring; accepts an
  injected duplex transport for in-process tests.
- `src/parsedDocument.ts` &mdash; version-keyed lex+parse+symbol-table cache.
- `src/taskSchemas.ts` &mdash; wraps `workflow-engine`'s schemas-only
  export so feature code never imports the engine runtime directly.
- `src/util/position.ts` &mdash; DSL `SourceLocation` &harr; LSP
  `Position` / `Range`.
- `src/features/` &mdash; one file per LSP feature (filled out in
  later phases).
- `test/` &mdash; jest specs; the integration harness drives the
  server in-process over a `node:stream` pair.

## Build / test

```sh
pnpm --filter workflow-lsp build
pnpm --filter workflow-lsp test
```
