# 03 - VS Code extension

Status: **Stub** - design pending.
Owner: TBD.
Depends on: 01 (per feature), 02, 04.
Blocks: 05 (web app reuses the LSP server).

Maps to PLAN: [Track C](./PLAN.md#track-c---vs-code-extension-parallel-after-a-lands-per-feature).
C.0 can start as soon as 0c lands (uses a stub core); C.1–C.5 are
mutually independent and individually deliverable.

## TL;DR

Promote
[`extensions/agr-language`](https://github.com/microsoft/TypeAgent/tree/main/ts/extensions/agr-language) from a
syntax-only extension to a full LSP client + webview debug panel host,
backed by `grammar-tools-core`. Coverage and diff surfaces ship
incrementally as B.3 / B.4 land.

## Scope

Grouped by PLAN Track C item.

- **C.0** Multi-package layout: `client/`, `server/`, `webview/`. Reuse
  existing TextMate grammar and `language-configuration.json`.
- Language server (`vscode-languageserver/node`):
  - **C.1** Diagnostics on change / save. _Needs A.2._
  - **C.2** Go-to-definition for `$(rule)` references. _Needs A.3._
  - **C.3** Find-references for rule names. _Needs A.3._
  - **C.4** Hover with rule signature + doc comment. _Needs A.3._
  - **C.5** Document formatting. _Needs A.4._
  - (Stretch) Document symbols for the outline. _Needs A.3._
- **C.6** Debug webview panel (hosts `grammar-tools-ui` bundle from
  chunk 04):
  - Grammar picker (active editor / agent picker).
  - Live completion preview pane.
  - Rule-level trace table.
    _Needs B.1, B.2, D.0–D.3._
- **C.7** Coverage decorations (highlight unmatched rules in editor).
  _Needs B.3 + C.0._
- **C.8** Diff command (text or basic side-by-side view). _Needs B.4 +
  C.0._
- Commands: `Grammar: Open Debugger`, `Grammar: Format Document`,
  `Grammar: Reveal Rule`, `Grammar: Run Coverage`, `Grammar: Diff With...`.

## Non-scope

- Inline (in-editor) completion preview popup. Completion preview is in
  the debug panel for v1.

## Open questions

- Should the extension also publish a tree view (rule outline) in the
  side bar, or rely on the document outline?
- ~~Webview <-> extension messaging contract - reuse the same JSON shape
  that the web app's HTTP API uses?~~ Resolved by
  [ADR 0005](./decisions/0005-shared-service-contract.md): both use
  `grammar-tools-core` signatures over the chosen framing. Wire
  framing (plain RPC vs JSON-RPC 2.0) is an open sub-decision in
  ADR 0005 owned by Track C.

## Verification

- Manual E2E checklist on
  [`extensions/agr-language/sample.agr`](https://github.com/microsoft/TypeAgent/blob/main/ts/extensions/agr-language/sample.agr)
  and on a real agent grammar (e.g. `player`).
- Snapshot tests for LSP responses against fixture grammars.
