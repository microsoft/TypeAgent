# Grammar Tools - Top-Level Plan

Status: Draft. This document is the single source of truth for the grammar
viewer / editor / debugger effort. Per-chunk design docs live alongside it
and are linked from the [Chunks](#chunks) section. Architectural decisions
live under [`decisions/`](./decisions/).

## Motivation

`.agr` grammars now sit on the critical path for natural-language
understanding in TypeAgent: every agent ships one, the dispatcher
loads them at startup, and they are the first thing that decides
whether a user's utterance routes to the right action. Today they are
authored by hand in plain text editors, debugged by reading matcher
logs, and validated by writing Jest tests against the compiled output.
There is no language service, no in-place trace of why a rule did or
did not match, and no way to see grammar coverage against a real
corpus of inputs.

This effort exists to close that gap for three audiences:

- **Agent authors** writing or editing a grammar need normal editor
  affordances: parse-error squiggles, go-to-definition for rule
  references, hover for rule expansions, format-on-save, and a way to
  preview "what completions does this grammar offer for input X" without
  spinning up the whole shell.
- **Dispatcher / matcher developers** debugging match behavior need a
  rule-level trace ("which rules were entered, which parts attempted,
  where did it backtrack") tied back to the source line, so the answer
  to "why didn't this match" stops being "read the debug log".
- **Quality / release engineers** rolling out grammar changes need
  coverage against a corpus and a structural diff between two versions,
  so a refactor that silently drops a rule is caught before it ships.

The same primitives serve all three, which is why the plan centers on a
single framework-agnostic core service surface and reuses it across VS
Code, the web app, the shell, and the CLI. The alternative - one-off
tools per host - is what we have today, and it is why grammar work is
slower than it needs to be.

## Naming conventions

Following the repo convention (see `packages/memory/*` for an example of
nested packages, e.g. `packages/memory/conversation` →
`conversation-memory`):

- All new grammar tooling packages live under a single parent directory:
  **`packages/grammarTools/`** (camelCase). The `actionGrammar` package
  stays where it is.
- **Directory names** are camelCase / short: `packages/grammarTools/core`,
  `packages/grammarTools/ui`, `packages/grammarTools/explorer`,
  `examples/grammarStudio`.
- **Package names** (in `package.json` `name` field, and `pnpm --filter`
  arguments) are kebab-case: `grammar-tools-core`, `grammar-tools-ui`,
  `grammar-tools-explorer`, `grammar-studio`.
- `pnpm-workspace.yaml` will need a new glob entry
  `packages/grammarTools/*` alongside the existing
  `packages/memory/*`, `packages/agents/*`, etc.

Throughout this plan, paths use the camelCase directory form and inline
`code spans` use the kebab-case package name when referring to a package
identity.

## TL;DR

Build a `.agr` tooling suite around a new framework-agnostic
**`grammar-tools-core`** package that exposes language-service primitives
(parse + diagnostics, references / definitions, hover, format, completion
preview, rule-level match trace, **coverage, diff**). Land the full core
service surface (including coverage and diff) and the CLI alongside the
first host (VS Code extension + LSP + webview debug panel) so every
later host inherits a frozen API. Then port to a **Vite web app**
(Monaco + monaco-languageclient) and embed that bundle in the **shell**
(live dispatcher grammars). Coverage and diff **UI surfaces** roll out
per host as that host comes online. NFA / DFA graph visualization is
deferred.

## Goals

- One implementation of grammar language services, reused across surfaces.
- Authoring loop: edit `.agr`, see diagnostics, navigate rules, format.
- Debug loop: enter input, see completions and a rule-level match trace.
- Quality loop: run a corpus, see coverage; diff two grammars.
- Multiple input sources: file on disk, agent manifest, live dispatcher.
- Maximize parallel work via fixture backends and per-feature deliverables.

## Non-Goals (v1)

- NFA / DFA graph visualization.
- Coverage / diff **rich UI** in every host on day one (CLI first; UI per
  host as it ships).
- Replacing the existing `actionGrammarCompiler` CLI.
- Authoring of action schemas (that is `schemaStudio`'s job).

## Surfaces and what they share

- **`grammar-tools-core`** - framework-agnostic, no DOM. All language
  services and debug services. Wraps existing APIs in
  [`packages/actionGrammar/src/index.ts`](../../../packages/actionGrammar/src/index.ts).
- **`grammar-tools-ui`** - shared widgets (debug panel, completion preview,
  rule-trace table). UI tech TBD - see
  [decision 0001](./decisions/0001-shared-ui-tech.md).
- **Per-surface adapters** - VS Code extension / LSP, Express web app, shell
  panel, CLI commands.

## Phases

Phases describe **delivery milestones**, not strict serial gates. Each
phase has multiple parallel tracks; see [Parallelization](#parallelization)
for the concurrency model.

1. **Foundation** - ADRs resolved, matcher instrumentation in
   `actionGrammar`, `grammar-tools-core` exposes the **complete service
   surface** (loader, diagnostics, symbols, format, completion preview,
   trace, **coverage, diff**), and the CLI exercises every service.
   Shared UI scaffolded against a fixture backend.
2. **VS Code extension** (first host) - extend
   [`extensions/agr-language`](../../../extensions/agr-language) with LSP
   - debug webview consuming the shared UI. Coverage + diff exposed via
     commands / panel as they're ready. **Decision gate** before adding
     more hosts.
3. **Web app** - new `packages/grammarTools/explorer` (package name
   `grammar-tools-explorer`, Express + Vite + Monaco) reusing the LSP
   server and the same shared UI bundle.
4. **Shell integration** - dispatcher RPC for live grammar snapshots,
   shell debug panel hosting the Phase 3 bundle.

Coverage and diff **services** ship in Phase 1; their **UI surfaces** ship
per host in the host's own phase.

## Steps (organized by track)

Work is split into independent tracks. Within each track, items are
ordered by dependency; across tracks, items proceed in parallel modulo
the dependencies called out below.

### Critical path (Track 0)

These are the only strictly serial items. Everything else fans out from
here.

0a. Resolve ADR [0001](./decisions/0001-shared-ui-tech.md) (UI tech)
and ADR [0002](./decisions/0002-trace-hook.md) (trace hook). 0002 is
**Accepted**; 0001 must land before Track D can scaffold (D.0).
ADRs [0003](./decisions/0003-grammar-snapshot.md) (snapshot
transport) and [0004](./decisions/0004-monaco-lsp-transport.md) (LSP
transport) are not on the critical path; they are sequenced into
Tracks F and G below.
0b. **Chunk 02**: matcher instrumentation in `actionGrammar` (source
spans + trace hook + **`PartId` assignment on the source AST,
propagated through every optimizer pass**). _Blocks A.2, A.5,
B.\*, and the trace-consuming parts of E._
0c. **Chunk 01 scaffold**: `packages/grammarTools/core` package layout,
`pnpm-workspace.yaml` glob, public types stubbed.
_Blocks A.\*, C.\*, D backend, E.\*, F._

### Track A - Core language services (parallel after 0c)

A.1 Loader (file, agent, snapshot). _Needs 0c._
A.2 Diagnostics. _Needs 0c + 0b spans._
A.3 Symbol index (definitions / references / signatures). _Needs 0c._
A.4 Formatter (wraps `writeGrammarRules`). _Needs 0c._
A.5 `GrammarDebugInfo` emission in `actionGrammar` (compiler-side
sidecar that maps `RuleId` / `PartId` to `SourceLocation`).
_Needs 0b (PartId assignment + optimizer propagation). Lives in
`actionGrammar` alongside the compiler; `grammar-tools-core`
re-exports it. **B.3 coverage and C.7 decorations are unusable
until A.5 lands** - until then, `runCoverage` throws
`MissingDebugInfoError` per chunk-01 contract._

### Track B - Core debug + quality services (parallel after 0c)

B.1 Completion preview. _Needs only 0c (uses existing
`matchGrammarCompletion`). Can start before 0b finishes._
B.2 Rule-level trace. _Needs 0b trace hook._
B.3 Coverage (per-rule / per-part hit counts). _Needs 0b trace hook._
B.4 Diff (structural rule-level diff). _Needs A.3 symbol index only._

### Track C - VS Code extension (parallel after A.\* lands per feature)

C.0 Multi-package layout (`client/`, `server/`, `webview/`), reuse of
existing TextMate grammar. _Can start as soon as 0c lands; uses a
stub core for early wiring._
C.1 LSP diagnostics. _Needs A.2._
C.2 LSP go-to-definition. _Needs A.3._
C.3 LSP find-references. _Needs A.3._
C.4 LSP hover. _Needs A.3._
C.5 LSP document formatting. _Needs A.4._
C.6 Webview debug panel (completion preview + rule trace). _Needs B.1,
B.2, D.\*._
C.7 Coverage decorations (highlight unmatched rules). _Needs B.3 + C.0._
C.8 Diff command (text or basic side-by-side). _Needs B.4 + C.0._
C.1–C.5 are mutually independent and individually deliverable.

### Track D - Shared UI (parallel after ADR 0001)

**Resolve [ADR 0001](./decisions/0001-shared-ui-tech.md) before D.0.**

D.0 Scaffold `packages/grammarTools/ui` with chosen UI tech and a
fixture `GrammarBackend` so D.1–D.5 do not block on real core.
D.1 `<completion-preview>` component.
D.2 `<rule-trace>` component.
D.3 `<grammar-picker>` component.
D.4 `<coverage-view>` component. _Real data needs B.3._
D.5 `<diff-view>` component. _Real data needs B.4._
D.1–D.5 are mutually independent.

### Track E - CLI (parallel after 0c, ships alongside core)

E.0 Scaffold `examples/grammarStudio` (new package; package name
`grammar-studio`). Not folded into `examples/schemaStudio` -
schema authoring and grammar tooling are kept as separate tools.
`--json` output mode is mandatory from E.0 so each later command
is CI-pipeable on the day it lands.
E.1 `grammar load`. _Needs A.1._
E.2 `grammar match`. _Needs B.1._
E.3 `grammar trace`. _Needs B.2._
E.4 `grammar coverage`. _Needs B.3._
E.5 `grammar diff`. _Needs B.4._
E.\* commands ship as the corresponding core service lands - the CLI
is the cheapest smoke-test for each service.

### Track F - Dispatcher snapshot (parallel after 0c + A.1 + A.5)

[ADR 0003](./decisions/0003-grammar-snapshot.md) is **Accepted**: the
RPC ships `{ grammar, debugInfo }` as JSON. F.1 therefore depends on
A.5 (compiler-side `GrammarDebugInfo` emission) as well as A.1.

F.1 New dispatcher RPC `getCompiledGrammarSnapshot(sessionId)` returning
`{ grammar: GrammarJson; debugInfo: GrammarDebugInfoJson }` (no source
bytes in v1; see ADR 0003). _Independent of host work; can land any
time after A.1 and A.5._

### Phase 2 sync point (decision gate)

After Track C (LSP features + debug panel) reaches a usable VS Code
build, do the manual E2E. **Gate** before starting Tracks G and H.

**Exit criteria.** All of the following must be true to open the gate:

1. **Tracks A and B shipped end-to-end in core.** Every Track A / B
   item has merged with tests; `pnpm --filter grammar-tools-core test`
   green; CLI commands E.1 - E.5 work against fixture grammars.
2. **VS Code extension landed.** C.1 - C.5 (LSP diagnostics, go-to-def,
   find-refs, hover, format) and C.6 (debug webview with completion
   preview + rule trace) all merged. C.7 (coverage decorations) and
   C.8 (diff command) are nice-to-have, not blocking.
3. **Manual E2E pass on three representative grammars.** Open
   [`extensions/agr-language/sample.agr`](../../../extensions/agr-language/sample.agr),
   one fixture grammar from
   [`packages/actionGrammar/test-data`](../../../packages/actionGrammar/test-data),
   and one real agent grammar (e.g. `player`); for each, verify:
   parse-error squiggles, F12 / Shift+F12 navigation, hover, format,
   and the debug-panel completion trace matches Jest expectations.
4. **ADRs 0003 and 0004 resolved.**
   [ADR 0003](./decisions/0003-grammar-snapshot.md) (snapshot transport)
   blocks Track H; [ADR 0004](./decisions/0004-monaco-lsp-transport.md)
   (LSP transport) blocks Track G.
5. **Open chunk-01 follow-ups closed or scheduled.** The dispatcher
   snapshot's debug-info contract (chunk 01 open question, surfaces
   in ADR 0003) is resolved. **A.5 (`GrammarDebugInfo` emission)
   has landed** - without it, B.3 / C.7 are inert and the gate's
   coverage criteria are vacuous.

**Decision and owner.** A single named owner runs the manual E2E (item 3) and signs off the gate; sign-off is a comment on the tracking issue
or a short note in [STATUS.md](./STATUS.md). If any criterion slips,
the gate stays closed and Tracks G / H wait. There is no partial
opening.

### Track G - Web app (after gate)

**Resolve [ADR 0004](./decisions/0004-monaco-lsp-transport.md) before G.0.**

G.0 Scaffold `packages/grammarTools/explorer` (Express + Vite).
G.1 Express server: list / load grammars, REST endpoints proxying core,
WebSocket endpoint for monaco-languageclient.
G.2 Vite SPA: Monaco editor with the `.agr` TextMate grammar,
monaco-languageclient bridged to the LSP server from C.
G.3 Mount the shared UI debug panel.
G.4 Add coverage / diff panels (use D.4 / D.5).
G.1–G.3 are mutually independent.

### Track H - Shell integration (after gate, parallel with Track G)

H.1 Wire dispatcher RPC F.1 into the shell main process.
H.2 Shell debug panel hosting the Track G SPA bundle in "live" mode.

## Parallelization

The goal is to keep the critical path (Track 0) tight and let everything
else fan out. Two principles enable this:

1. **Fixture backends.** Track D ships a fake `GrammarBackend`
   implementation so UI components can be developed before real core
   services land. Same trick optionally for Track C (stub LSP
   responses).
2. **Per-feature deliverables.** Tracks A, B, C, D, E are each
   decomposed to items shippable as independent PRs. No track is a
   single monolithic deliverable.

Dependency overview:

```
ADR 0001 ┬──► D.0 (UI scaffold)
ADR 0002 ┘
   │
   ▼
Chunk 02 (0b) ──┬──► A.2 ──► C.1
               ├──► A.5 (debug-info emission) ──┬──► B.3 ──► C.7
               │                                 └──► F.1 (with A.1)
               └──► B.2 ──► C.6 (with B.1 + D.1–D.2)

Chunk 01 scaffold (0c) ──┬──► A.1, A.3, A.4 ──► C.2–C.5
                        ├──► B.1, B.4 ──► C.6, C.8
                        └──► E.0–E.5 (parallel CLI smoke tests)

F.1 (dispatcher RPC) needs A.1 + A.5 (per ADR 0003).

Decision gate (after C.\*) ──► G.\*  │
                           └──► H.\*  ┘ parallel
```

### Risks and gotchas

- **Critical path is short but real.** ADRs → Chunk 02 → Chunk 01
  scaffold gates everything else. Land it first.
- **Trace hook (0b) blocks four downstream items** (B.2, B.3, C.6, C.7).
  Even though it's small, do not let it slip.
- **Fixture backend in D.0 is a force multiplier.** Without it, UI
  serializes behind core; with it, both tracks proceed concurrently.
- **Single-developer execution still benefits.** "Pick any item from
  Tracks A/B/D/E whose deps are met" is a useful WIP rule.
- **Decision gate enforces a real sync barrier.** Tracks G and H wait
  even if everything else has finished early.

## Chunks

Each chunk has its own design doc. Add detail there as we iterate; keep
this top-level plan stable.

| #   | Chunk                                                | Doc                                                              |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| 01  | `grammar-tools-core` package                         | [01-core.md](./01-core.md)                                       |
| 02  | actionGrammar instrumentation (spans + trace)        | [02-matcher-instrumentation.md](./02-matcher-instrumentation.md) |
| 03  | VS Code extension (LSP + commands)                   | [03-vscode-extension.md](./03-vscode-extension.md)               |
| 04  | Shared UI (`grammar-tools-ui`)                       | [04-shared-ui.md](./04-shared-ui.md)                             |
| 05  | Web app (`grammar-tools-explorer`)                   | [05-web-app.md](./05-web-app.md)                                 |
| 06  | Shell integration                                    | [06-shell-integration.md](./06-shell-integration.md)             |
| 07  | CLI                                                  | [07-cli.md](./07-cli.md)                                         |
| 08  | Coverage and diff (services in Phase 1; UI per host) | [08-coverage-and-diff.md](./08-coverage-and-diff.md)             |

### Reading order

The chunk file numbers are stable identifiers, not a recommended reading
order. To follow the design dependency-first, read in this order:

| Order | File                                                             | Track / Phase     | Why here                                                     |
| ----- | ---------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| 1     | [02-matcher-instrumentation.md](./02-matcher-instrumentation.md) | Track 0 / Phase 0 | Trace + span prereqs that everything else cites.             |
| 2     | [01-core.md](./01-core.md)                                       | Track A / Phase 1 | `LoadedGrammar`, services, error contract.                   |
| 3     | [08-coverage-and-diff.md](./08-coverage-and-diff.md)             | Track B / Phase 1 | Last two core services; locks chunk-02 trace consumer shape. |
| 4     | [07-cli.md](./07-cli.md)                                         | Track E / Phase 1 | First host; cheapest validation of the core API.             |
| 5     | [03-vscode-extension.md](./03-vscode-extension.md)               | Track C / Phase 1 | Second host; first LSP / webview surface.                    |
| 6     | [04-shared-ui.md](./04-shared-ui.md)                             | Track D / Phase 1 | Reused by VS Code webview, web app, and shell.               |
| 7     | [05-web-app.md](./05-web-app.md)                                 | Track G / Phase 2 | Post-gate; Monaco + LSP transport.                           |
| 8     | [06-shell-integration.md](./06-shell-integration.md)             | Track H / Phase 2 | Post-gate; embeds web bundle in live mode.                   |

## Decisions

Architectural decisions are tracked as ADRs under
[`decisions/`](./decisions/). Open decisions block the chunks that depend
on them.

| ADR  | Topic                                    | Status                                                                    |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------- |
| 0001 | Shared UI tech (Lit vs React vs vanilla) | [Open - resolve before Track D](./decisions/0001-shared-ui-tech.md)       |
| 0002 | Match trace hook strategy                | [Accepted (option A)](./decisions/0002-trace-hook.md)                     |
| 0003 | Live grammar snapshot transport          | [Accepted](./decisions/0003-grammar-snapshot.md)                          |
| 0004 | Monaco LSP transport                     | [Open - resolve before Track G](./decisions/0004-monaco-lsp-transport.md) |
| 0005 | Shared service contract                  | [Accepted](./decisions/0005-shared-service-contract.md)                   |

## Relevant existing files

- [`packages/actionGrammar/src/index.ts`](../../../packages/actionGrammar/src/index.ts) - public APIs to wrap.
- [`packages/actionGrammar/src/grammarMatcher.ts`](../../../packages/actionGrammar/src/grammarMatcher.ts) - target for the trace hook.
- [`packages/actionGrammar/src/grammarRuleParser.ts`](../../../packages/actionGrammar/src/grammarRuleParser.ts) - source spans for diagnostics / go-to-def.
- [`packages/actionGrammar/src/agentGrammarRegistry.ts`](../../../packages/actionGrammar/src/agentGrammarRegistry.ts) - agent-grammar discovery.
- [`extensions/agr-language/`](../../../extensions/agr-language) - extend into LSP client + webview host.
- [`packages/cacheExplorer/webpack.config.js`](../../../packages/cacheExplorer/webpack.config.js), [`packages/knowledgeVisualizer/src/route/route.ts`](../../../packages/knowledgeVisualizer/src/route/route.ts) - templates for Express + SPA pattern.
- [`examples/schemaStudio/src/main.ts`](../../../examples/schemaStudio/src/main.ts) - template for `interactive-app` CLI.
- [`docs/architecture/actionGrammar.md`](../../architecture/actionGrammar.md), [`packages/actionGrammar/README.md`](../../../packages/actionGrammar/README.md), [`packages/actionGrammar/GRAMMAR_GENERATION.md`](../../../packages/actionGrammar/GRAMMAR_GENERATION.md) - background docs.

## Verification

1. **Core**: `pnpm --filter grammar-tools-core test` (filter uses the
   kebab-case package name) - loader, diagnostics (golden invalid `.agr`
   fixtures), completion preview parity with
   `packages/actionGrammar/test/grammarMatcherBasic.spec.ts`, trace event
   ordering for known inputs.
2. **VS Code**: open a sample `.agr` (e.g.
   [`extensions/agr-language/sample.agr`](../../../extensions/agr-language/sample.agr)
   or fixtures under `packages/actionGrammar/test-data`); verify squiggle
   on intentional parse error, F12 / Shift+F12 on rule references, hover,
   format, then open the Debugger panel and confirm completions match
   Jest expectations.
3. **Web app**: `pnpm run start` in `packages/grammarTools/explorer`,
   browse to the dev URL, load an agent's grammar (e.g. `player`), run
   completion preview, confirm Monaco LSP features active.
4. **Shell**: `pnpm run shell`, enable the debug panel flag, confirm the
   live grammar appears and completion preview matches the chat input.
5. **CLI**: `pnpm --filter grammar-studio start` then
   `grammar match "play "` against the player grammar - output matches
   Jest expectations.
6. **Lint / format**: `pnpm run prettier` clean across new packages.
