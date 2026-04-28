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

## Locked decisions (v1)

These are locked for Phase 1 so the Track B API can freeze. Revisit
post-Phase-2 only if a host surface demands more granularity.

### Diff granularity: rule-level

v1 reports **rule-level changes only**: `added`, `removed`, `changed`.
For `changed` rules we include both rules' canonical text (or AST) but
do **not** compute a structural sub-rule diff. Hosts that want a
sub-rule view can run a text diff on the canonical form.

```ts
type GrammarDiff = {
  added: RuleId[];
  removed: RuleId[];
  changed: Array<{ rule: RuleId; before: string; after: string }>;
};
```

Rationale: rule-level is the unit users reason about; sub-rule diff
multiplies API surface and pulls in tree-diff dependencies for marginal
v1 value. Upgrade path is additive (add `parts?: PartDiff[]` to
`changed` entries) so freezing now is safe.

### Coverage shape: source-coordinated, Istanbul-flavored

v1 emits per-rule and per-part hit counts **keyed by source location**,
not by abstract IDs alone. This requires chunk 02's per-part `pos` /
`end` guarantee and chunk 01's `GrammarDebugInfo.rules` /
`GrammarDebugInfo.parts` maps (emitted by Track A.5).

```ts
type CoverageReport = {
  grammarHash: string;
  totals: { rules: number; ruleHits: number; parts: number; partHits: number };
  rules: Array<{
    id: RuleId;
    location: SourceLocation; // requires debugInfo
    hits: number;
    parts: Array<{
      id: PartId;
      location: SourceLocation;
      hits: number;
    }>;
  }>;
  unmatched: Array<{ input: string; reason?: string }>;
};
```

Rationale: source coordinates unlock editor decorations (C.7) and web
gutter rendering (G.4) for free, and make the JSON shape close enough
to Istanbul that downstream tooling (badges, dashboards) can consume
it. The cost is a hard dependency on `GrammarDebugInfo`: coverage
**throws `MissingDebugInfoError`** when run against a `LoadedGrammar`
without `debugInfo` (per chunk 01's error contract). Hosts that load a
debug-info-less snapshot must surface this clearly.

### Coverage event source: reuse `TraceEvent`

v1 derives coverage by subscribing to chunk 02's `TraceEvent` stream
(`partMatched` increments part + rule hit counts; unmatched inputs
captured at the matcher boundary). No separate cheaper coverage event.

Rationale: keeps chunk 02's contract small; the trace hook is already
zero-overhead when no subscriber is attached, so coverage runs pay
exactly the trace cost and nothing extra. If benchmarks (per ADR 0002)
show coverage-only consumers want a cheaper path, we add a dedicated
event in a follow-up; the public coverage API does not change.

## Verification

- Coverage of a fixture grammar against a fixture corpus reproduces
  expected hit counts.
- Diff between a grammar and a hand-edited copy lists the expected
  changes.
