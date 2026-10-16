# Copilot fast actions status

Working tracker for [PLAN.md](./PLAN.md). Keep implementation, documentation,
and live verification as separate states.

_Last updated: 2026-10-16._

## Plugin-first program path

The repository-wide cleanup makes plugin ownership the default and only enabled
owner. Child-authored learning is required throughout the shared core; backend/
offline authorship, server lifecycle RPCs/owner composition and rollback are
removed. Automatic dev/PowerShell-first and MCP redirect hooks are removed;
explicit TypeAgent commands and the optional structured-action bridge remain.
Old owner settings and non-child jobs fail explicitly; re-record needed tasks.
The backend WorkIQ original-retention experiment is retired rather than retained
as a second implementation. No new retention parity or VS Code claim is made.

The A/B/C evidence below predates this cleanup. It proves the staged foundations,
not a new-default live release. Cleanup build/test results and any remaining
validation gates are tracked in the
[cleanup plan](../../../../../codeDocs/TypeAgent/forAgent/projects/inProgress/2026-10-15_plugin-first-fast-actions/cleanup-implementation-plan.md).

Cleanup offline validation passed the full workspace build, 429 core tests,
488 plugin tests plus final affected-suite regression checks, 263 evaluation
tests, 257 focused backend/provider tests, 15 launcher/layout tests and the
copied-package contained-execution proof. Formatting and all four repository
ratchets passed. These are offline checks, not a new live model/native recording
or certification of the new-default release.

| Area                                                         | State                                         | Evidence / remaining gate                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Shared recipe contracts and fake host (P1)                   | offline baseline tested                       | `copilot-macros/recipeCore` and `/recipeTesting`; program-only execution                                              |
| Lean grammar runtime (P1)                                    | tested                                        | `action-grammar/runtime` excludes generation/config/model initialization                                              |
| Host capability spike (P0)                                   | native child and C adapters proved            | CLI 1.0.97 / SDK 1.0.13: restricted children, exact tool invocation and separate-CLI isolated inference; not VS Code  |
| Isolated MCP bundle startup (P7 preparation)                 | tested                                        | Four copied-bundle selectors initialize/list tools without checkout, TypeAgent config or backend connection           |
| Catalog, authoring, semantic and optional TypeAgent adapters | offline components tested                     | Durable cross-process catalog/context storage, local commands and strict adapters; not live saved-program execution   |
| TypeAgent-hosted Checkpoint A                                | superseded; owner/learner removed             | Historical compiler/executor proof retained; shared implementation survives in plugin                                 |
| Copilot child authorship (B)                                 | required shared contract                      | Root success receipt, sealed context, durable leases and independent verification; historical B native evidence below |
| Standalone symbolic/hybrid release (P7/C)                    | plugin now default; cleanup live gate pending | Prior copied production plugin proof remains historical; no new-default live, VS Code or performance certification    |

The optional TypeAgent program adapter is now composed into the plugin-owned
executable host. Stable read-only action identities replace recorded protocol
scopes; all dependencies are preflighted before the first program dispatch.
Existing MCP tools run through native permissions without an extension-owned
backend connection. Offline integration tests cover mixed execution, missing and
changed dependencies, fresh scopes, structured statuses, actual-user fixture
continuation/cancellation, and lost replies without retry.

Native mixed recording, restricted authoring, approved publication and MCP reuse
have passed against an isolated real Dispatcher with synthetic read-only data.
The retained 256.3-second OBS recording has decoded readable request/result
frames and a fully decoded silent audio track. The final repeat made exactly one
root `run_macro` call and one fresh Vega backend action, with two read checkpoints,
zero semantic calls and no fallback. See the
[P6 validation report](../../../../../codeDocs/TypeAgent/forAgent/projects/inProgress/2026-10-15_plugin-first-fast-actions/typeagent-bridge-native-validation.md)
for the exact proof and failure history.

Live testing fixed Copilot's plugin-directory MCP working directory through
private session/profile workspace registration, clarified strict child builder
output fields, and removed a duplicate discovery that exceeded the inspection
deadline. Final validation passed the full workspace build, 415 core tests,
521 plugin tests and 15 layout/launcher tests, plus the four ratchets and actual
working-tree lint/complexity checks. Live interaction UI, rich forms/proposals,
writes and VS Code remain separate gates; no performance claim is made.

Final validation of these foundations passed the full workspace build,
379 macro tests, 409 plugin tests, 33 focused grammar tests, and 15
extension-layout/launcher tests. Copied hook commands and MCP catalogs make
no TypeAgent connection attempt. New recipe/probe functions meet the 25/30
complexity budgets; working-tree checks found no new lint violations.

Earlier foundation checks were supplemented with working-tree reports and
tests when ratchets returned no-op results. The final C checks enumerate changed
sources, including new files, and pass all four ratchets with no new violations
or cycles. No performance gate is claimed complete.

## Historical critical path and simplification

The following records the A/B/C delivery sequence. Its backend ownership and
compatibility arrangements are superseded by the repository-wide cleanup above.

The [implementation plan](../../../../../codeDocs/TypeAgent/forAgent/projects/inProgress/2026-10-15_plugin-first-fast-actions/implementation-plan.md)
now prioritizes these independently useful checkpoints:

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

### Checkpoint B implementation and evidence

- Native selected learning now requires an explicit parent success attestation
  correlated to the actual root receipt event, prompt hash, token, and final
  output. Idle/tool completion alone cannot queue a job.
- TypeAgent persists the sealed context and job; native background workers claim
  exact phase prompts under workspace/session/worker/digest/lease identities.
  Awaiting a compatible host is durable `awaitingAuthor`, not provider fallback.
- Each phase uses a tools-disabled native task child. The original answer does not
  wait for authoring. Native launch/result correlation, exact event filtering and
  child-only cancellation have live synthetic proof on SDK 1.0.13 / CLI 1.0.97.
- Native inherited-context isolation remains unproved and is not trusted. The
  independent source-blind verifier stays in TypeAgent. Its response is durably
  memoized before source authorship, including cold restart with a deliberately
  nondeterministic test verifier.
- Joined provider tests cover external claim/submission through real
  compilation/independent fixtures/publication and fresh-input contained replay.
  Failed/aborted sources, late replies, duplicate completion, Off/Cancel, new
  user preemption, and compatibility clients have targeted regression coverage.
- The native receipt-to-child proof and joined live child-to-publication proof
  both passed. The joined proof used eight real native author children, zero
  authoring business calls, actual compilation/publication and fresh GAMMA
  execution. Its source-blind verifier was explicitly deterministic and its
  transport an in-process adapter over public manager RPC methods; network RPC
  and default hosted-verifier checkpointing are covered separately by tests.
  C/local inference/VS Code host support and an all-default-model network
  deployment certification remain out of scope. No performance claim is made.

See [B lifecycle](../../../packages/copilot-macros/README.md#checkpoint-b-copilot-child-authorship).

Final B validation passed the full workspace build and 1,075 distinct tests:
400 macro, 172 focused production-provider, 443 plugin, 45 recording/runbook RPC,
and 15 layout/launcher tests. Formatting, six related documents' frontmatter and
68 local links, and all four ratchets passed. Because three ratchets enumerate
committed changes only, actual working-tree lint/complexity reports supplement
them: no new findings, with macro/plugin source within 25/30 complexity budgets.
Unrelated existing provider/plugin findings remain unchanged. A stale ignored
compiled runbook test with no source was removed before the current suites passed.

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
Checkpoint B's native child authorship is described above. C's implemented
plugin-owned path and current evidence are described below. Effectful activation
and broader schema compatibility remain separate work.

### Checkpoint C implementation and evidence

- `recipeOwner` selects `typeagent` (compatibility default), `plugin`, or `off`;
  changing it requires closing/restarting the session. Plugin-mode misses stay
  native; no backend planner fallback is used.
- The shared `MacroManager` is the sole local catalog, authoring/job,
  publication and run authority. The actual shared typed grammar matcher,
  compiler, fixture verifier and QuickJS executor are reused, not forked.
- One workspace/profile writer lease is held in SQLite for the owner lifetime.
  Authenticated session-bound IPC joins hook/MCP/command clients. Crash recovery
  relies on the OS lock, never PID-based stale-lock stealing; accepted or
  ambiguous dispatch is never automatically retried.
- Native `view`, `rg`, `glob` and explicitly classified read-only MCP calls
  retain normal native permission, hook and content-exclusion checks.
  Registry-derived canonical MCP identities and the same processed JSON result
  normalization connect actual captured events to programmatic invocation.
- Source authoring uses B's tools-disabled native children. Independent
  source-blind verification and bounded declared semantic calls instead use
  fresh isolated sessions on a separate installed native CLI, with ordinary
  login and no API-key/TypeAgent configuration or inherited root context.
  This is not same-process inference or an inherited-context isolation claim.
- Explicit semantic/JSON output obligations survive extraction and builder
  correction as mandatory independent program-verifier requirements. They are
  not discarded merely because the extractor cannot see private result bodies;
  genuine missing/failed evidence still blocks learning.
- The copied distribution carries real TypeScript libraries and the complete
  QuickJS worker/WASM dependency closure with licenses and hashes. Copied-package
  tests run outside the checkout under Node's stable permission model.
- A real copied production plugin has completed recording, child authorship,
  independent native verification, compilation/fixtures/publication, explicit
  fresh-input execution and grammar-routed fresh-input execution. Repeats
  returned GAMMA rather than recorded ALPHA with zero root model calls and
  empty semantic evidence; TypeAgent was deliberately unavailable.
- The joined proof also passes the actual copied MCP server's `run_macro`,
  a fresh-input hybrid sentiment program with exactly one declared native
  inference call, and ready symbolic replay after replacing the native
  client/session. The hybrid returned `{"sentiment":"negative"}` for a fresh
  negative message, with provider/model/token evidence rather than a stub.
- Native synchronous child RPC results can precede their completion events.
  The launcher now awaits the exact child's notification within the original
  deadline, preserving all tool restrictions, registry correlation and
  child-only cancellation; it never accepts the RPC result alone.
- Thirteen actual native adapter checks pass, including schema inspection,
  native/MCP reads and denials, hooks, recursion rejection, cancellation,
  isolated canary inference and typed semantic inference.
- Final regression validation passed the full workspace build and **1,150
  distinct tests**: 415 core, 174 focused provider, 501 plugin, 15
  extension-layout/launcher and 45 server compatibility tests. Formatting and
  all four lint/complexity/circular/debt ratchets pass for the changed sources.

See the external [implementation plan](../../../../../codeDocs/TypeAgent/forAgent/projects/inProgress/2026-10-15_plugin-first-fast-actions/implementation-plan.md)
for persisted proof and remaining release gates. VS Code, effectful execution,
performance/speedup certification, and plugin-update compatibility are not
implied by this native CLI evidence. Interrupted-job handoff and writer-lock
crash recovery are unit-tested; live plugin-update compatibility and paired
baseline overhead measurement remain release work. One live observation
delivered the selected answer in 6.856 seconds and reached recipe readiness in
78.960 seconds; this is not an overhead or speedup estimate.

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
