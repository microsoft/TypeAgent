# Copilot fast actions status

Working tracker for [PLAN.md](./PLAN.md). Keep implementation, documentation,
and live verification as separate states.

_Last updated: 2026-10-16._

## Plugin-first program path

Checkpoint A is now program-only. Dev-action behavior is unchanged; B/C remain separate gates.

| Area                                                         | State                      | Evidence / remaining gate                                                                                           |
| ------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Shared recipe contracts and fake host (P1)                   | offline baseline tested    | `copilot-macros/recipeCore` and `/recipeTesting`; program-only execution                                            |
| Lean grammar runtime (P1)                                    | tested                     | `action-grammar/runtime` excludes generation/config/model initialization                                            |
| Host capability spike (P0)                                   | partial; release gate open | Copilot child/context/local inference remain unproved                                                               |
| Isolated MCP bundle startup (P7 preparation)                 | tested                     | Four copied-bundle selectors initialize/list tools without checkout, TypeAgent config or backend connection         |
| Catalog, authoring, semantic and optional TypeAgent adapters | offline components tested  | Durable cross-process catalog/context storage, local commands and strict adapters; not live saved-program execution |
| TypeAgent-hosted Checkpoint A                                | implemented, default       | Actual compiler/executor, production author/provider, read-only MCP broker, grammar and explicit calls              |
| Standalone symbolic/hybrid release (P7/C)                    | blocked                    | Requires Copilot child/context and local adapters/clean-install evidence; no performance claim                      |

The optional TypeAgent program adapter now has 39 passing offline protocol
tests covering discovery, preflight, execution, continuation, and cancellation.
It uses the existing MCP protocol without opening its own backend connection.
Live mixed-recipe execution remains gated on P3 and designated-backend tests.

Final validation of these foundations passed the full workspace build,
379 macro tests, 409 plugin tests, 33 focused grammar tests, and 15
extension-layout/launcher tests. Copied hook commands and MCP catalogs make
no TypeAgent connection attempt. New recipe/probe functions meet the 25/30
complexity budgets; working-tree checks found no new lint violations.

The standard lint/complexity/debt ratchets currently enumerate committed
changes only, so their successful no-op results were supplemented with
working-tree reports and tests. The dependency-cycle ratchet passed with
no new cycles. No live-release or performance gate is claimed complete.

## Revised critical path and simplification

The program prioritizes these independently useful checkpoints:

1. **A: TypeAgent-hosted code-first recipes.** Keep TypeAgent recording, catalog,
   grammar matching, and execution; add program authoring/compilation, contained
   execution, and a strict adapter over its configured model provider. A symbolic
   repeat uses no model; a hybrid repeat uses only declared semantic calls.
2. **B: Copilot child authorship.** Prove the restricted child and explicit context
   handoff while TypeAgent still validates, matches, and runs the same artifacts.
3. **C: plugin-local ownership and standalone delivery.** Move matching and
   coordination incrementally; prove local inference, clean installation, and
   no-TypeAgent operation separately. VS Code needs its own compatibility proof.

Checkpoint A is configured by both server entry points without a rollout flag.
The former step replay engine, runner profiles/bridge and adaptation APIs are
removed. Old development/test records are discarded, not migrated. The usual
local dev profiles contained no saved program or legacy catalog entries.

The only executable macro kind is a checked program. All runs resolve the current
approved revision through one invocation path. All auto-publishes validated local
successes; Prepare remains staged. The initial broker accepts read-only MCP tools
available to TypeAgent and rejects writes/native-only tools explicitly.
Schemas, containment, cancellation, backend authorization and uncertainty evidence
remain; there is no planning child or extra recipe-layer consent.

The moved host report remains relevant to B/C. Its earlier missing TypeAgent
compiler/author/model findings are superseded by A, not evidence that the remaining
Copilot-local seams are available or unavailable.

### Checkpoint A implementation and evidence

- New supported recordings always become checked programs.
  Step-only drafts cannot be persisted, approved, or run. The initial production broker accepts
  read-only TypeAgent MCP tools; native-only tools and writes fail explicitly.
- Actual TypeScript diagnostics and compile-on-publication feed a worker-contained
  QuickJS/WASM executor, not Node `vm` or `new Function`. CPU, guest memory,
  stack, JSON, broker-call, and cancellation bounds have explicit ceilings.
- Production authoring derives source-independent fixture expectations and runs
  the stored executable against strict stubs. The configured semantic provider
  makes bounded tools-disabled completions with actual model/token evidence.
  The author rejects semantic declarations needing custom source-ID/quotation
  provenance validators before publication; they cannot become unusable ready programs.
- Grammar and explicit calls return fresh structured results without a planning
  runner. Disabled/superseded revisions stop future calls; accepted failures
  never fall back to legacy execution. Durable run journals preserve interrupted
  or uncertain dispatch evidence; automatic continuation is not implemented.
- Historical pre-cutover validation passed the full workspace build and **429 macro tests,
  410 plugin tests, 15 layout/launcher tests, 161 focused provider tests, two
  recording RPC tests, and three lean grammar tests**. The provider tests include
  actual contained execution and an actual read-only MCP filesystem child process
  over temporary synthetic files, through grammar and explicit invocation.
- Separate live synthetic proofs passed: the production default author generated
  a checked symbolic program with fresh-input output; the production semantic
  provider and strict adapter made one real `gpt-6-luna` completion, recording
  302 input and 44 output tokens. These are component live proofs, not a full
  Copilot UI/WorkIQ certification or a latency benchmark.
- Required ratchets passed; lint/complexity/debt's committed-only scope is
  supplemented by actual working-tree reports. New program sources have no lint
  violations and meet cyclomatic 25/cognitive 30 budgets. No new dependency cycles.

A full default-production synthetic proof also passed after cutover: actual MCP
recording, real extraction/build/grammar/author models, compilation/fixtures,
automatic All publication, explicit fresh-file execution and grammar-routed
fresh-file execution. Repeats returned BETA/GAMMA rather than recorded ALPHA,
with zero repeat model calls, no handoff and no extra recipe consent. This exposed
and fixed author validation against the draft rather than approved grammar version.
It is not a Copilot UI, WorkIQ or performance certification.

Final program-only validation passed the full workspace build and **958 distinct
regression tests**: 389 macro, 150 focused provider, 368 plugin, 15 layout/launcher,
33 recording RPC/runbook binding, and three lean grammar tests.
Formatting and all four required ratchets passed. Actual working-tree reports
supplement their committed-only scope: no macro lint violations or over-budget
functions, no new provider violations, and no over-budget plugin functions.
Existing unrelated plugin/provider lint findings are not changed by this work.

See [containment limits and lifecycle](../../../packages/copilot-macros/README.md#checkpoint-a-typeagent-hosted-programs).
Copilot child authorship (B), plugin-owned matching/standalone inference (C),
effectful activation, and broader schema compatibility remain future work.

## Implementation status

| Area                                       | Status  | Notes                                                                                  |
| ------------------------------------------ | ------- | -------------------------------------------------------------------------------------- |
| Dev-mode PowerShell schema-family routing  | done    | Static namespaces and dynamic flows receive first refusal                              |
| Typed handled and not-handled dispositions | done    | `notSuitable` returns the original prompt to Copilot                                   |
| PowerShell capability fallback             | done    | Existing-flow preference, synthesis, aliases, and bounded repair                       |
| Transactional flow creation                | done    | Pending, execute once, promote, reload, and rollback                                   |
| Flow persistence and same-process locking  | done    | Cross-process storage locking remains open                                             |
| Explicit macro trace recording             | done    | One armed interaction per session                                                      |
| Macro induction and validation             | done    | Narrow deterministic induction from one trace                                          |
| Immutable macro approval                   | done    | Approval creates a new version                                                         |
| Contained program execution                | done    | Actual compiler/QuickJS execution, MCP broker and bounded semantics                    |
| Step replay / macro runner / adaptation    | removed | No legacy execution or candidate submission fallback                                   |
| Recording controls                         | done    | Recording and induction only; program runtime unconditional                            |
| Approved macro grammar routing             | done    | Dynamic typed actions, learned routing, version/source fingerprints, lifecycle refresh |
| Routed program execution                   | done    | Same current approved program path as explicit invocation                              |

## Documentation status

| Item                                                  | Status                     |
| ----------------------------------------------------- | -------------------------- |
| Cross-package plan                                    | done                       |
| Plugin README routing and dev-mode correction         | done                       |
| Plugin README macro lifecycle and component inventory | done                       |
| Macro package README replacement                      | done                       |
| Workflow architecture PowerShell security correction  | done                       |
| Published architecture page                           | deferred until plan review |

## Open implementation work

- [ ] Replace FullLanguage dynamic PowerShell execution with an untrusted
      execution boundary.
- [ ] Require explicit first-run approval for generated, repaired, edited, and
      imported dynamic scripts until that boundary exists.
- [ ] Add storage-level locking for independent agent-server processes.
- [ ] Add forced process-tree termination after cancellation or timeout.
- [ ] Make credentialed end-to-end dev-action and macro scenarios a release
      gate.
- [ ] Decide whether to build a catalog over other TypeAgent flow providers.

## Documentation follow-up

- [ ] Review the `copilot-fastActions` directory name before more documents
      link to it.
- [ ] Promote stable cross-package material into a published architecture page
      after review.
- [ ] Add a link from the plugin and macro READMEs to that architecture page.
- [ ] Recheck security wording when the PowerShell execution boundary changes.

## Validation checklist

- [x] Commands match current hook command parsing.
- [x] Dev-mode options match `hook-dev-actions.ts`.
- [x] Macro lifecycle matches `MacroManager`.
- [x] Containment and broker guarantees match program executor/runtime.
- [x] Program routing, input changes, lifecycle invalidation and recording controls covered by focused tests.
- [ ] Validate generated/persisted NFA macro routes against live Agency tools after restart.
- [x] Validate default production authoring and fresh-input grammar/explicit execution over synthetic MCP files.
- [x] Package ownership follows the wiki contribution guide.
- [ ] Build the DocFX site when the plan is promoted into published content.
