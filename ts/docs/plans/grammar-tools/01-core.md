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
- A.5 `GrammarDebugInfo` emission in `actionGrammar` (compiler
  sidecar; depends on chunk 02 `PartId` assignment). Re-exported
  from `grammar-tools-core`. **Blocks B.3 coverage shipping with
  source coordinates and C.7 decorations.**

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
// loader (A.1) - returns LoadResult so compile failures don't poison the type
export function loadGrammarFromFile(path: string): Promise<LoadResult>;
export function loadGrammarFromAgent(agentName: string): Promise<LoadResult>;
export function loadGrammarFromSnapshot(snapshot: GrammarSnapshot): LoadResult;

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

## Loading model

`LoadedGrammar` is a data envelope with `grammar` always present plus
**two optional fidelity layers** (`debugInfo`, `files`). Hosts pick
which loader to call based on what they have; services declare which
layers they need.

```
┌─────────────────────────────────────────┐
│  files: SourceFile[]                    │  ← edit / format / find-refs
│  (text + AST + spans, per file)         │     [optional]
├─────────────────────────────────────────┤
│  debugInfo: GrammarDebugInfo            │  ← go-to-def, "rule X @ file:line"
│  (Grammar node ↔ source position map)   │     [optional]
├─────────────────────────────────────────┤
│  grammar: Grammar                       │  ← match, complete, trace, coverage
│  (the substrate, always present)        │     [required]
└─────────────────────────────────────────┘
```

**Invariant.** Once you have a `LoadedGrammar`, `grammar` is always
usable. Compile failures never produce a `LoadedGrammar` with a missing
grammar - they're encoded at the loader boundary as `LoadResult` (see
below), so every service can dereference `g.grammar` unconditionally.

### Loader result and compile failure

Loader factories return a discriminated `LoadResult` rather than
throwing. This keeps editor / LSP hosts in control of how to react to a
bad parse without forcing every downstream service to test for a
missing grammar.

```ts
export type LoadResult =
  | { ok: true; grammar: LoadedGrammar }
  | { ok: false; diagnostics: Diagnostic[]; files: SourceFile[] };
```

For LSP-style hosts that want continuity across keystrokes, the
recommended pattern is **last-known-good**: the host caches the most
recent `ok: true` result and keeps offering services against it while a
new edit re-parses; on `ok: false`, surface the diagnostics from the
failure but keep the cached grammar live for completion / trace. Core
itself is stateless; this caching lives in the host (see chunks 03,
05, 06).

### Scenarios

| #   | Scenario                                     | Host provides                |   `files`   | `debugInfo` | `grammar` | Notes                                                                   |
| --- | -------------------------------------------- | ---------------------------- | :---------: | :---------: | :-------: | ----------------------------------------------------------------------- |
| 1   | VS Code editor, single `.agr`                | path + live buffer text      |      ✓      |  ✓ emitted  |     ✓     | Failed parse → `LoadResult.ok = false`; host keeps last-known-good      |
| 2   | Web editor (Vite SPA)                        | text buffer (+ virtual id)   |      ✓      |  ✓ emitted  |     ✓     | Same as #1                                                              |
| 3   | Agent grammar (file mode)                    | agent name / manifest path   | ✓ (N files) |  ✓ emitted  |     ✓     | Compiles N source files, emits unified debug info                       |
| 4a  | Live dispatcher snapshot **with** debug info | RPC `{ grammar, debugInfo }` |      ✗      |      ✓      |     ✓     | Symbol service works ("rule X is in agent Y file Z"); diagnostics empty |
| 4b  | Live dispatcher snapshot **without** debug   | RPC `{ grammar }`            |      ✗      |      ✗      |     ✓     | Match / trace / coverage work; symbols throw `MissingDebugInfoError`    |
| 5   | CLI coverage run                             | path or agent + corpus       |  (loaded)   |  (emitted)  |     ✓     | Cheapest path: load → run → exit                                        |
| 6   | Decompiled view (any of 4a / 4b)             | `decompile(grammar)`         | ✓ synthetic | ✓ synthetic |     ✓     | Read-only; lets snapshot mode show source-shaped UI                     |

### Per-service requirements

| Service             |       `grammar`        | `debugInfo` | `files` | Notes                                 |
| ------------------- | :--------------------: | :---------: | :-----: | ------------------------------------- |
| `previewCompletion` |   ✓ (always present)   |             |         |                                       |
| `traceMatch`        |   ✓ (always present)   |             |         | `debugInfo` enriches event display    |
| `runCoverage`       |   ✓ (always present)   |             |         | `debugInfo` enables source decoration |
| `diffGrammars`      |    both `grammar`s     |             |         | `debugInfo` enables jump-to-source    |
| `getSymbolIndex`    |   ✓ (always present)   |      ✓      |         | Index keyed by `RuleId` / `PartId`    |
| `getDiagnostics`    |                        |             |    ✓    | Per-file parse + semantic errors      |
| `format`            | (operates on raw text) |             |         |                                       |

Services that need a fidelity layer the host did not provide return a
typed error (`MissingDebugInfoError` / `MissingSourceError`) per the
chunk-01 error contract. Hosts that want symbol navigation against a
snapshot without debug info call `decompile()` first.

### Lifecycle and regeneration

- **Immutable.** Each parse / compile produces a new `LoadedGrammar`.
  Editor mode replaces the handle on every (debounced) successful
  reload. No incremental reparse for v1.
- **Caching is the host's job.** Core exposes pure functions; the LSP
  server holds the latest `LoadedGrammar` per open document and the
  last-known-good when a new parse fails.
- **Snapshot refresh.** Live mode (chunk 06) replaces the
  `LoadedGrammar` whenever the dispatcher reports a new snapshot.
- **Lazy decompile.** When `files` is absent, callers can opt in to
  `decompile(grammar)` to synthesize a read-only `SourceFile` plus
  matching `debugInfo` for display purposes.

## Error handling

Three kinds of failure show up in `grammar-tools-core`. Each has one
canonical channel; services do not mix channels.

| Failure kind                                                                                    | Channel                                                             | Example                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| **Recoverable, in-source.** Parse / semantic problem in user content                            | `Diagnostic[]` (returned by `getDiagnostics()` or by `LoadResult`)  | Unknown rule reference, unclosed bracket, type mismatch |
| **Catastrophic load.** No usable grammar can be produced                                        | `LoadResult.ok = false` carries `Diagnostic[]` plus partial `files` | File doesn't parse at all; agent manifest missing       |
| **Misuse / missing fidelity layer.** Caller asked for something the loaded handle can't provide | Typed exception                                                     | `getSymbolIndex()` on a snapshot without `debugInfo`    |

### Diagnostics, not exceptions, for in-source problems

Anything that originates in user-authored grammar text is a
`Diagnostic`, never an exception. This includes parse errors, dangling
references, and any future semantic checks. Diagnostics carry source
ranges so editor / LSP hosts can render them inline.

```ts
const result = await loadGrammarFromFile(path);
if (!result.ok) {
  // Catastrophic load - render result.diagnostics, keep last-known-good.
} else {
  const diags = getDiagnostics(result.grammar); // semantic warnings/errors
  // Render diagnostics; grammar is still usable.
}
```

`LoadResult.ok = false` is reserved for the case where **no compiled
grammar can be produced at all**. A grammar that compiles but has
warnings is `ok: true` with non-empty diagnostics.

### Typed exceptions for caller misuse

Services that depend on a fidelity layer beyond `grammar` throw a
typed exception when that layer is absent. This is **caller misuse**
(host called the wrong service for the handle it loaded), not a data
problem, so an exception is appropriate. Hosts that want to handle
the case gracefully test the handle before calling.

```ts
export class GrammarToolsError extends Error {
  readonly code: string;
}

export class MissingDebugInfoError extends GrammarToolsError {
  readonly code = "MISSING_DEBUG_INFO";
  constructor(public readonly source: GrammarSource) {
    /* ... */
  }
}

export class MissingSourceError extends GrammarToolsError {
  readonly code = "MISSING_SOURCE";
  constructor(public readonly source: GrammarSource) {
    /* ... */
  }
}
```

Service-by-service rules:

| Service             | Throws                  | When                                                 |
| ------------------- | ----------------------- | ---------------------------------------------------- |
| `previewCompletion` | -                       | Never throws on a `LoadedGrammar`                    |
| `traceMatch`        | -                       | Never throws on a `LoadedGrammar`                    |
| `runCoverage`       | -                       | Returns a `CoverageReport` even on empty corpus      |
| `diffGrammars`      | -                       | -                                                    |
| `getSymbolIndex`    | `MissingDebugInfoError` | Handle has no `debugInfo`                            |
| `getDiagnostics`    | `MissingSourceError`    | Handle has no `files`                                |
| `format`            | -                       | Returns input unchanged when source is not parseable |

**Cheap guard helpers.** Core exposes type-guard predicates so hosts
can avoid try/catch for the common case:

```ts
export function hasDebugInfo(
  g: LoadedGrammar,
): g is LoadedGrammar & { debugInfo: GrammarDebugInfo };
export function hasSource(
  g: LoadedGrammar,
): g is LoadedGrammar & { files: readonly SourceFile[] };
```

### Internal invariant violations

Anything that indicates a bug inside `grammar-tools-core` or
`actionGrammar` (e.g. a grammar node missing an expected field,
inconsistent identifier index) throws a plain `Error` and is **not** a
public API contract. Hosts should not catch these; they should crash and
report.

## Type sketches (placeholders)

These are **starting points to unblock parallel work**, not frozen
contracts. Concrete shapes land with each Track A / B item.

### `LoadedGrammar`

Three-layer envelope (see "Loading model" above). `grammar` is always
present; `debugInfo` and `files` are optional fidelity layers.

```ts
export interface LoadedGrammar {
  /** Where the grammar came from. */
  readonly source: GrammarSource;

  /** Compiled grammar - what the matcher consumes. Always present;
   *  loader compile failures are reported via `LoadResult`, not by
   *  omitting this field. */
  readonly grammar: Grammar; // re-exported from actionGrammar

  /** Maps grammar nodes back to source positions. Emitted by the
   *  loader when compiling from source; may be supplied by the
   *  snapshot RPC ([ADR 0003]); synthesized by `decompile()`. */
  readonly debugInfo?: GrammarDebugInfo;

  /** Source files that contributed. Empty / absent for snapshot mode
   *  unless `decompile()` populated synthetic source. */
  readonly files?: readonly SourceFile[];

  /** Stable identifier table used by trace events and coverage to
   *  refer to rules / parts. Derived from `grammar`. See chunk 02
   *  "Stable rule + part identifier". */
  readonly identifiers: GrammarIdentifierIndex;
}

export type GrammarSource =
  | { kind: "file"; path: string }
  | { kind: "buffer"; id: string } //  in-memory editor buffer
  | { kind: "agent"; agentName: string; manifestPath: string }
  | { kind: "snapshot"; sessionId?: string }
  | { kind: "decompiled"; from: GrammarSource };
```

### `SourceFile`

One `.agr` source contributing to a `LoadedGrammar`.

```ts
export interface SourceFile {
  /** Stable identifier - file path, or virtual id for in-memory
   *  buffers / decompiled output. Matches `SourceLocation.fileId`
   *  in `GrammarDebugInfo`. */
  readonly id: string;
  readonly text: string;
  /** Parser AST. Includes source spans. May reflect a partial parse
   *  when there are errors - inspect `getDiagnostics()` to find them. */
  readonly ast: GrammarParseResult;
  /** True when the file is synthesized by `decompile()` and not
   *  user-editable. */
  readonly synthetic?: boolean;
}
```

### `GrammarDebugInfo`

Compiler-emitted sidecar mapping grammar nodes to source positions.
Analogous to `.pdb` / source maps. Persisted as a separate JSON
document (`.agr.debug.json`) so it can travel alongside the compiled
grammar without bloating it.

```ts
export interface GrammarDebugInfo {
  /** Stable hash of the Grammar this debug info describes; used to
   *  detect drift if loaded separately. */
  readonly grammarHash: string;

  /** Source location for each rule, keyed by `RuleId` (rule name). */
  readonly rules: Map<RuleId, SourceLocation>;

  /** Source location for each part with a source counterpart. Keyed
   *  by `PartId` (compile-time integer assigned at parse and
   *  propagated through optimization; see chunk 02 "PartId
   *  stability"). Optimizer-internal parts (e.g. dispatch wrappers)
   *  are not present. */
  readonly parts: Map<PartId, SourceLocation>;
}

export interface SourceLocation {
  /** Logical id of the source file; matches `SourceFile.id` when
   *  source is available. */
  readonly fileId: string;
  /** Display path; not necessarily readable from the host (e.g.
   *  snapshot mode shows the path but cannot open the file). */
  readonly displayPath: string;
  readonly range: SourceRange;
}
```

### `Diagnostic`

LSP-shaped, no `vscode-languageserver-types` dependency in core.

```ts
export interface Diagnostic {
  range: SourceRange;
  severity: "error" | "warning" | "info" | "hint";
  code?: string;
  message: string;
  source: "grammar-tools-core";
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}
export interface SourcePosition {
  line: number; // 0-based
  character: number; // 0-based, UTF-16 code units
  offset: number; // absolute byte / char offset (parser-native)
}
```

### `CoverageReport` (placeholder, see chunk 08)

```ts
export interface CoverageReport {
  totals: { rules: number; parts: number; ruleHits: number; partHits: number };
  perRule: Map<RuleId, RuleCoverage>;
  perPart: Map<PartId, PartCoverage>;
  unmatchedInputs: string[];
}
```

### `GrammarDiff` (placeholder, see chunk 08)

Rule-level for v1.

```ts
export interface GrammarDiff {
  added: RuleId[];
  removed: RuleId[];
  changed: Array<{ rule: RuleId; reason: "signature" | "body" | "value" }>;
}
```

### Decompile API (placeholder)

Declared here; implementation deferred to a later chunk (Track A.5 or
folded into A.1). Lets hosts produce a viewable / traceable
`LoadedGrammar` from a snapshot that lacks source.

```ts
/** Synthesize a read-only SourceFile + matching debugInfo from a
 *  Grammar. Returns a new LoadedGrammar with `source.kind = "decompiled"`. */
export function decompile(grammar: Grammar): LoadedGrammar;
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

- ~~Exact shape of `LoadedGrammar` - what to expose vs. keep opaque?~~
  See "Loading model" + type sketches above; refine when A.1 lands.
- Should the package be browser-safe (Web Worker hosting an LSP server)?
  See [ADR 0004](./decisions/0004-monaco-lsp-transport.md).
- Agent-grammar loader: does
  [`agentGrammarRegistry`](../../../packages/actionGrammar/src/agentGrammarRegistry.ts)
  cover all merge cases, or do we need to rerun the merger?
- Diff granularity (rule-only vs part-level) - see chunk 08.
- Coverage output shape - simple counts vs. range-addressed hits suitable
  for editor decorations - see chunk 08.
- ~~`GrammarDebugInfo` emission belongs in `actionGrammar` (next to the
  compiler) or in `grammar-tools-core` (post-processing).~~ Decided
  2026-04-28: lives in `actionGrammar` as Track A.5, alongside the
  `PartId` assignment from chunk 02; `grammar-tools-core` re-exports.
- Whether the dispatcher snapshot (ADR 0003) ships `debugInfo` alongside
  `grammar`, source bytes, both, or neither. Updates ADR 0003.

## Verification

- Unit tests parity with `packages/actionGrammar/test`.
- Public API surface frozen via a `.d.ts` snapshot test.
