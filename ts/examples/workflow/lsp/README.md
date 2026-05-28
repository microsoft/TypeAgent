# workflow-lsp

Language Server Protocol implementation for the workflow DSL (`.wf` files).

The server runs over stdio (CLI/CI) or Node IPC (the VS Code extension
child-process mode), and exposes the standard LSP surface plus two
TypeAgent-specific custom requests.

## Features

Standard LSP capabilities:

| Capability                      | Notes                                                     |
| ------------------------------- | --------------------------------------------------------- |
| Diagnostics (publish on change) | Debounced; mirrors `compile()` lex/parse/typecheck errors |
| Hover                           | Const/param types, task signatures                        |
| Completion                      | Task names, keywords, in-scope identifiers                |
| Definition / References         | Const, param, and workflow-call resolution                |
| Document & range formatting     | Wraps `format()` from `workflow-dsl`                      |
| Rename                          | Locally-scoped identifier rename                          |
| Document symbols                | Workflow + const outline                                  |
| Semantic tokens                 | Typed highlighting                                        |
| Code actions                    | Quick-fix suggestions for common errors                   |

TypeAgent custom requests:

| Method                  | Params            | Result                                                                                                    |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `workflow/compileIR`    | `{ uri: string }` | `{ ir?, errors: { phase, message, line, col }[] }`                                                        |
| `workflow/previewGraph` | `{ uri: string }` | `{ graph?: GraphModel, graphs?: { name, graph: GraphModel }[], errors: { phase, message, line, col }[] }` |

`GraphModel` is re-exported from `workflow-dsl` and is covered by a
snapshot test (`test/graphShape.spec.ts`) so editors can rely on the
shape across versions.

## Layout

- `src/index.ts` — bin entry; starts the server on stdio.
- `src/server.ts` — connection wiring; accepts an injected duplex
  transport for in-process tests.
- `src/parsedDocument.ts` — version-keyed lex+parse+symbol-table cache
  shared by all feature handlers.
- `src/taskSchemas.ts` — wraps `workflow-engine`'s schemas-only export
  so feature code never imports the engine runtime directly.
- `src/util/position.ts` — DSL `SourceLocation` ⇄ LSP `Position` / `Range`.
- `src/features/` — one file per LSP feature.
- `test/` — Jest specs. `serverIntegration.spec.ts` drives the server
  in-process over a `node:stream` pair using real JSON-RPC.

## Build / test

```sh
pnpm --filter workflow-lsp build
pnpm --filter workflow-lsp test
```

> **Note on `--forceExit`:** the `jest-esm` script passes `--forceExit`.
> The in-process integration tests in `serverIntegration.spec.ts` open
> a `vscode-jsonrpc` `Connection` over a `node:stream` pair. After full
> dispose of the client, server, streams, and reader/writer, jest still
> hangs ~10s because `vscode-jsonrpc`'s internal worker queue keeps
> `setImmediate`/microtask handles alive that aren't exposed via
> `Connection.dispose()`. This is a test-harness-only issue — production
> uses `LanguageClient`, which the extension host tears down cleanly.
> Remove `--forceExit` only if vscode-jsonrpc grows a sync drain API.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
