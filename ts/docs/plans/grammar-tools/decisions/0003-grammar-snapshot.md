# ADR 0003 - Live grammar snapshot transport

Status: **Open**. Resolve before: **Track F start** (dispatcher RPC F.1)
and chunk 06 scaffolding.
Blocks: 06.

## Context

The shell debug panel (chunk 06) needs the live dispatcher session's
compiled grammar. The shell main process owns the grammar; the debug
panel runs in a renderer (or browser) process. We need a transport.

## Options

### A. Serialize via `grammarToJson` and ship over RPC _(recommended)_

- Reuses
  [`grammarSerializer.ts`](../../../packages/actionGrammar/src/grammarSerializer.ts).
- Pros: same panel works in browser context too (chunk 05's web app),
  uniform contract.
- Cons: serialization cost; source spans may not round-trip (see chunk
  02 open question).

### B. In-process `GrammarStore` reference

- Pros: zero serialization, full fidelity.
- Cons: only works inside the shell, forces a different code path in
  the panel for the live case vs. the file case.

## Decision

_Pending._ Recommendation: **A**.

## Consequences

If A: the panel always speaks JSON, regardless of host. If B: chunk 06
needs a forked panel implementation for the in-process case.
