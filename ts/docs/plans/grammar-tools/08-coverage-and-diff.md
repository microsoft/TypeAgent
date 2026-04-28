# 08 - Coverage and Diff

Status: **Stub** - design pending.
Owner: TBD.
Depends on: 01 (services), 03 / 05 / 06 (UI surfaces per host).

Maps to PLAN: services land in Phase 1 as **B.3 (coverage)** and **B.4
(diff)** - see
[Track B](./PLAN.md#track-b---core-debug--quality-services-parallel-after-0c).
UI surfaces ship per host: **C.7 / C.8** in VS Code, **G.4** in the web
app, equivalent in shell. CLI surfaces are **E.4 / E.5** in
[Track E](./PLAN.md#track-e---cli-parallel-after-0c-ships-alongside-core).

## TL;DR

Deliver coverage and diff in two layers:

1. **Services in Phase 1** (Track B). Lock the API surface alongside
   the rest of `grammar-tools-core` so every host inherits a frozen
   contract. CLI consumes them immediately as the cheapest validation.
2. **UI per host** as that host ships. VS Code (C.7 / C.8), web app
   (G.4), shell (Track H). Each host can iterate UX without churning
   the core API.

## Scope

### Services (Phase 1, Track B)

- **B.3 Coverage service**: run a corpus of inputs, accumulate
  per-rule and per-part hit counts, report unmatched inputs.
- **B.4 Diff service**: structural diff of two `LoadedGrammar`s
  (rules added / removed / changed; per-rule structural diff).

### CLI (Phase 1, Track E)

- **E.4** `grammar coverage <corpus.txt>` - text output with
  optional `--json`.
- **E.5** `grammar diff <a> <b>` - text output with optional `--json`.

### UI (per host, as the host ships)

- VS Code: **C.7** coverage decorations (highlight unmatched rules in
  the editor), **C.8** diff command (text or basic side-by-side).
- Web app: **G.4** coverage panel + side-by-side diff using the
  shared **D.4 / D.5** components.
- Shell: reuses the web-app bundle in live mode (Track H).

## Non-scope

- Mutation testing of grammars.
- Performance profiling of the matcher.

## Open questions

- Diff granularity - rule-level only, or down to part / token level?
  Locking this early in Phase 1 is important because the API shape
  cascades to every host.
- Coverage output format - simple counts, or more like Istanbul
  (line / branch coverage in source coordinates)? The latter unlocks
  editor decorations for free but requires per-part source spans (chunk
  02 must guarantee these).
- Should the **coverage event stream** reuse the chunk 02 `TraceEvent`
  hook, or should the matcher emit a distinct (cheaper) coverage
  event? Affects the size of the chunk 02 contract.

## Verification

- Coverage of a fixture grammar against a fixture corpus reproduces
  expected hit counts.
- Diff between a grammar and a hand-edited copy lists the expected
  changes.
