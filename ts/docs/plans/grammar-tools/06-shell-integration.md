# 06 - Shell integration

Status: **Stub** - design pending.
Owner: TBD.
Depends on: 01 (A.1 snapshot loader), 05, ADR
[0003 - grammar snapshot transport](./decisions/0003-grammar-snapshot.md).

Maps to PLAN: dispatcher RPC = [Track F](./PLAN.md#track-f---dispatcher-snapshot-parallel-after-0c--a1--a5)
(can land any time after A.1 and A.5, independent of host work). Shell
panel = [Track H](./PLAN.md#track-h---shell-integration-after-gate-parallel-with-track-g),
which starts after the Phase 2 decision gate and runs in parallel with
Track G.

## TL;DR

Add a developer panel inside
[`packages/shell`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/shell) (gated by a debug flag) that
loads the chunk-05 SPA bundle and points it at the **live dispatcher
session's compiled grammar** via a new RPC method.

## Scope

- **F.1** New dispatcher RPC `getCompiledGrammarSnapshot(sessionId)`
  returning a serializable grammar (uses `grammarToJson`). Independent
  of host work; can land as soon as the A.1 snapshot contract is
  settled.
- **H.1** Wire F.1 into the shell main process.
- **H.2** Shell debug panel (BrowserWindow or iframe) hosting the SPA
  bundle in "live" mode; panel's grammar picker can choose between live
  dispatcher grammars and any other source.

## Non-scope

- Production-user-facing exposure (debug-only).
- Editing the live grammar in place (read-only for v1).

## Open questions

- Where does the debug panel live in the shell UI - menu item, command
  palette, or hidden behind a `DEBUG=` flag? See parent
  [PLAN.md](./PLAN.md).
- ~~Should the snapshot include source spans, or only the compiled
  rules / NFA / DFA?~~ Resolved by
  [ADR 0003](./decisions/0003-grammar-snapshot.md): ships
  `{ grammar, debugInfo }`, no source bytes in v1. F.1 therefore
  depends on A.5 as well as A.1.

## Verification

- Run `pnpm run shell`, enable debug flag, panel opens.
- Snapshot of the live `player` grammar matches the same grammar loaded
  via file path in the web app.
