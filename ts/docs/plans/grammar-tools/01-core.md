# 01 - `grammar-tools-core`

Status: **Stub** - design pending.
Owner: TBD.
Depends on: [02 - matcher instrumentation](./02-matcher-instrumentation.md)
for source spans (Track A.2) and trace events (Track B.2 / B.3).
Blocks: 03, 04, 05, 06, 07, 08.

Maps to PLAN tracks: [0c scaffold](./PLAN.md#critical-path-track-0),
[Track A](./PLAN.md#track-a---core-language-services-parallel-after-0c),
[Track B](./PLAN.md#track-b---core-debug--quality-services-parallel-after-0c).

> Directory: `packages/grammarTools/core`. Package name (in
> `package.json` and `pnpm --filter`): `grammar-tools-core`.

## TL;DR

Framework-agnostic TypeScript package that wraps
[`packages/actionGrammar`](../../../packages/actionGrammar) and exposes
the **complete** service surface every surface needs: load, diagnostics,
symbols, format, completion preview, rule-level match trace, coverage,
diff. Goal is to freeze the API in Phase 1 so later hosts inherit it
unchanged.

## Scope

Grouped by PLAN track. Each item is independently shippable.

### Track A - language services

- A.1 Loader (file path, agent manifest, serialized snapshot).
- A.2 Diagnostics (LSP-shaped `Diagnostic[]` with source ranges).
- A.3 Symbol index (definitions, references, signatures).
- A.4 Formatter (wraps `writeGrammarRules`).

### Track B - debug + quality services

- B.1 Completion preview (wraps `matchGrammarCompletion`, returns
  UI-ready shape).
- B.2 Rule-level match tracer (consumes the trace hook from chunk 02).
- B.3 Coverage (per-rule / per-part hit counts over a corpus).
- B.4 Diff (structural rule-level diff between two `LoadedGrammar`s).

## Non-scope

- DOM / UI code (lives in chunk 04).
- Coverage / diff **visualization** (per-host UI in chunks 03, 05, 06).
- NFA / DFA graph extraction.

## Public API sketch

> Concrete signatures land with each Track A / B item.

```ts
// loader (A.1)
export function loadGrammarFromFile(path: string): Promise<LoadedGrammar>;
export function loadGrammarFromAgent(agentName: string): Promise<LoadedGrammar>;
export function loadGrammarFromSnapshot(
  snapshot: GrammarSnapshot,
): LoadedGrammar;

// language services (A.2 - A.4)
export function getDiagnostics(g: LoadedGrammar): Diagnostic[];
export function getSymbolIndex(g: LoadedGrammar): SymbolIndex;
export function format(source: string): string;

// debug services (B.1 - B.2)
export function previewCompletion(
  g: LoadedGrammar,
  input: string,
  cursor?: number,
): CompletionPreview;
export function traceMatch(g: LoadedGrammar, input: string): MatchTrace;

// quality services (B.3 - B.4)
export function runCoverage(
  g: LoadedGrammar,
  corpus: Iterable<string>,
): CoverageReport;
export function diffGrammars(a: LoadedGrammar, b: LoadedGrammar): GrammarDiff;
```

## File layout

```
packages/grammarTools/core/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── loader.ts          # A.1
│   ├── diagnostics.ts     # A.2
│   ├── symbols.ts         # A.3
│   ├── format.ts          # A.4
│   ├── completion.ts      # B.1
│   ├── trace.ts           # B.2
│   ├── coverage.ts        # B.3
│   └── diff.ts            # B.4
└── test/
    ├── loader.spec.ts
    ├── diagnostics.spec.ts
    ├── symbols.spec.ts
    ├── format.spec.ts
    ├── completion.spec.ts
    ├── trace.spec.ts
    ├── coverage.spec.ts
    └── diff.spec.ts
```

## Open questions

- Exact shape of `LoadedGrammar` - what to expose vs. keep opaque?
- Should the package be browser-safe (Web Worker hosting an LSP server)?
  See [ADR 0004](./decisions/0004-monaco-lsp-transport.md).
- Agent-grammar loader: does
  [`agentGrammarRegistry`](../../../packages/actionGrammar/src/agentGrammarRegistry.ts)
  cover all merge cases, or do we need to rerun the merger?
- Diff granularity (rule-only vs part-level) - see chunk 08.
- Coverage output shape - simple counts vs. range-addressed hits suitable
  for editor decorations - see chunk 08.

## Verification

- Unit tests parity with `packages/actionGrammar/test`.
- Public API surface frozen via a `.d.ts` snapshot test.
