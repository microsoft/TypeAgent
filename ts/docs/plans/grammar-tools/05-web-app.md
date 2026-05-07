# 05 - Web app (`grammar-tools-explorer`)

Status: **Stub** - design pending.
Owner: TBD.
Depends on: 01, 03 (LSP server), 04. Starts after the Phase 2
[decision gate](./PLAN.md#phase-2-sync-point-decision-gate).

Maps to PLAN: [Track G](./PLAN.md#track-g---web-app-after-gate).
G.1–G.3 are mutually independent.

> Directory: `packages/grammarTools/explorer`. Package name:
> `grammar-tools-explorer`.

## TL;DR

Express + Vite SPA modeled on
[`packages/cacheExplorer`](../../../packages/cacheExplorer) and
[`packages/knowledgeVisualizer`](../../../packages/knowledgeVisualizer),
hosting Monaco + monaco-languageclient against the same LSP server the
VS Code extension uses, plus the shared debug panel from chunk 04.

## Scope

- **G.0** Scaffold the package (Express + Vite, dev / start scripts
  mirroring `cacheExplorer`).
- **G.1** Express server:
  - `GET /grammars` - list (file system + agent registry).
  - `GET /grammars/:id` - load source.
  - WebSocket endpoint for monaco-languageclient.
  - REST endpoints proxying `grammar-tools-core` services.
- **G.2** Vite SPA: Monaco editor with the `.agr` TextMate grammar
  reused from chunk 03; monaco-languageclient bridged to the LSP server.
- **G.3** Mount the shared debug panel from chunk 04 (D.1–D.3).
- **G.4** Mount coverage / diff panels (D.4 / D.5) once they're
  available.

## Non-scope

- Auth (local dev tool).
- Multi-user state.

## Open questions

- LSP transport - websocket back to a Node-hosted server, or LSP in a
  Web Worker? See [ADR 0004](./decisions/0004-monaco-lsp-transport.md).
- Should this share an Express app with `cacheExplorer` /
  `knowledgeVisualizer` for a unified dev portal?

## Verification

- `pnpm run start` opens the dev URL.
- Load `player` grammar, edit it, see diagnostics, run completion
  preview, results match Jest expectations.
