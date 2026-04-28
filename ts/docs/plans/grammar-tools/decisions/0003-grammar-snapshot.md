# ADR 0003 - Live grammar snapshot transport

Status: **Accepted** (2026-04-28). Three sub-decisions: transport,
debug-info, source bytes.
Blocks: 06, F.1.

## Context

The shell debug panel (chunk 06) needs the live dispatcher session's
compiled grammar. The shell main process owns the grammar; the debug
panel runs in a renderer (or browser) process. We need a transport.

Two follow-on questions surfaced during chunk 01 / 02 review and are
resolved here together: whether the snapshot ships `GrammarDebugInfo`,
and whether it ships the original `.agr` source bytes.

## Decisions

### 1. Transport: JSON via `grammarToJson` over RPC (option A)

The RPC payload is the JSON shape produced by
[`grammarSerializer.ts`](../../../packages/actionGrammar/src/grammarSerializer.ts).
The panel always speaks JSON regardless of host - the same code path
serves the shell, the chunk-05 web app (live mode), and any future
host. This is the only choice consistent with
[ADR 0005](./0005-shared-service-contract.md), which declares
`grammar-tools-core` signatures as the wire contract for every
transport.

Option B (in-process `GrammarStore` reference) would have forced a
forked panel implementation for the in-process case and an exception
to ADR 0005. Rejected.

### 2. Ship `GrammarDebugInfo` alongside the grammar

The RPC payload is `{ grammar, debugInfo }`. This unblocks live
coverage (chunk 08 B.3) and "reveal rule X" (chunk 01 symbol service)
in the shell debug panel without requiring `decompile()`.

Mechanically: the dispatcher retains the `GrammarDebugInfo` emitted by
A.5 (chunk 01 / 02) per session and serializes it alongside the
grammar. Cost is low once A.5 lands - debug info is a small sidecar.

This closes chunk 01's open question "whether the dispatcher snapshot
ships `debugInfo` alongside `grammar`." Scenario 4a in chunk 01
("snapshot **with** debug info") is the only live-mode scenario; 4b
(snapshot without debug info) is removed.

### 3. Do not ship `.agr` source bytes in v1

The dispatcher does not retain `.agr` source after compile today, and
chunk 06 declares the shell panel read-only for v1. Adding source
retention is a real architectural change with little payoff: hosts
that want a source-shaped view call `decompile(grammar)` (chunk 01),
which synthesizes a read-only `SourceFile` from the compiled grammar.

Revisit if and only if the shell panel becomes editable, or a host
specifically needs to display the original (un-decompiled) source.
Until then, `LoadedGrammar.files` is absent in snapshot mode (matches
scenario 4a in chunk 01).

## Consequences

- F.1 RPC signature is
  `getCompiledGrammarSnapshot(sessionId): Promise<GrammarSnapshot>`
  where `GrammarSnapshot = { grammar: GrammarJson; debugInfo: GrammarDebugInfoJson }`.
  Both halves serialize through `grammarSerializer.ts` (existing for
  grammar; new for debug info as part of A.5).
- F.1 cannot ship before A.5 lands (RPC payload depends on
  `GrammarDebugInfo`). Update Track F dependency in PLAN.
- Chunk 06 panel uses scenario 4a uniformly; `decompile()` is the
  fallback only if a future host opts into a `grammar`-only payload.
- Chunk 02 open question "do source spans round-trip through the
  serializer" is moot for the snapshot path: snapshot ships
  `debugInfo` (a separate map), not source-span-annotated AST nodes.
  The question remains relevant for any future feature that needs to
  send the parser AST itself across a process boundary.
