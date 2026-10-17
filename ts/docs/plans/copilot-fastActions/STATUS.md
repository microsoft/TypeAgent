# Copilot fast actions status

Working tracker for [PLAN.md](./PLAN.md). Stable contracts live in
[Checked program macros](../../architecture/workflows/macros.md) and
[provider flow architecture](../../architecture/workflows/workflows.md).
Implementation, historical test evidence, live qualification and documentation
validation are separate states.

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
| Host capability spike (P0)                                  | native child and C adapters proved            | CLI 1.0.97 / SDK 1.0.13: restricted children, exact tool invocation and separate-CLI isolated inference; not VS Code  |
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

A/B/C describe delivered increments, not three executable macro formats:

1. **A:** TypeAgent recording, authoring, verification, publication and execution.
2. **B:** restricted native child authorship while TypeAgent retains the other roles.
3. **C:** opt-in plugin coordination using the same portable core/runtime.

Only checked programs are executable. Step replay, the macro planning runner,
adaptation APIs and execution flags are removed. Old development-only records
are discarded, not migrated. Grammar and explicit calls resolve the current
approved revision through one invocation path. Prepare stages candidates;
Read-only/All can publish validated local successes, without overriding tool
authorization or enabling writes.

The component-only catalog/fake-host milestones preceded runnable A/B/C.
They must not be read as a current claim that saved-program execution is missing.

### Checkpoint B implementation and evidence

Selected native learning requires a token-bound parent success attestation and
subsequent final answer. Idle/tool completion alone is insufficient. Durable
`awaitingAuthor`, exact request/digest/lease identities, source-blind verifier
checkpointing and child-only cancellation preserve the learning boundary.
New user work preempts the child with a recoverable lease; Off/Cancel rejects
late work. There is no default-author fallback for contextual failures.

Historical synthetic proof used native CLI 1.0.97 / SDK 1.0.13 restricted children
and actual program publication/fresh execution. The joined proof used an
in-process adapter over public manager methods and an explicitly deterministic
trusted verifier. RPC transport and hosted-verifier recovery were tested
separately; this is not an all-default-model network deployment certification.

Representative public coverage:

- [Receipt correlation](../../../packages/copilot-plugin/test/macroTaskReceipt.spec.ts).
- [Exact child completion and retirement](../../../packages/copilot-plugin/test/macroAuthorChild.spec.ts).
- [Durable learning and stale submissions](../../../packages/copilot-macros/test/macroChildLearning.spec.ts).
- [Joined production-provider program path](../../../packages/defaultAgentProvider/test/checkpointBPrograms.spec.ts).

### Checkpoint A implementation and evidence

Both server entry points configure program authoring/execution without a rollout
flag. Independently derived fixture expectations gate actual compilation and
stored-executable execution. Journals retain interrupted/uncertain dispatch;
automatic run continuation is not implemented.

Historical production-path synthetic proof covered real extraction/build/grammar/
authoring, fixture validation, All publication and explicit/grammar fresh-file
repeats with zero repeat model calls. Separate bounded semantic-provider proof
established a real model call and usage evidence. These are not Copilot UI,
organizational-data or speedup certifications.

See [compiler/executor coverage](../../../packages/copilot-macros/test/recipeExecutor.spec.ts)
and [runtime contracts](../../../packages/copilot-macros/README.md#checkpoint-a-typeagent-hosted-programs).

### Checkpoint C implementation and evidence

The copied production distribution includes TypeScript libraries, QuickJS worker/
WASM dependencies, licenses and asset hashes. Historical no-TypeAgent proof
covered fresh-input symbolic execution, MCP `run_macro`, a hybrid program with
one declared inference call, and ready-symbolic-artifact restart.

Independent verification and semantics use fresh tools-disabled sessions on a
separate installed native CLI, not same-process inference. The standalone facade
refreshes registry generation between calls but rejects owner changes and
mid-inference generation changes. Source authorship remains a native restricted
task child. A synchronous task reply may precede its completion event; the
launcher waits for and correlates that event within the original deadline.

The optional action bridge's native synthetic proof covered mixed recording,
restricted authorship, publication and MCP reuse through a real Dispatcher.
Stable read-only action identity replaces transient protocol scopes. All declared
dependencies are preflighted before program dispatch. Lost replies remain
uncertain and are never repeated automatically. Actual-user interaction fixtures
are covered; live interaction UI, rich forms and interactive learning are not.

Representative public coverage:

- [Native host](../../../packages/copilot-plugin/test/recipeNativeHost.spec.ts)
  and [isolated inference](../../../packages/copilot-plugin/test/recipeNativeModel.spec.ts).
- [IPC ownership and crash-lock recovery](../../../packages/copilot-plugin/test/localRecipeTransport.spec.ts).
- [Copied distribution](../../../packages/copilot-plugin/scripts/test/checkpoint-c-package.spec.mjs).
- [Mixed action host and preflight](../../../packages/copilot-plugin/test/recipeTypeAgentHost.spec.ts).

These are scoped historical records. Test totals from different development
checkpoints are not a cumulative suite or a fresh pass of the documentation
patch. Answer-delivery latency and recipe-readiness latency are different
measurements; no paired performance/cost/break-even result is established.

## Implementation status

| Area                                       | Status               | Boundary                                                                            |
| ------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------- |
| Windows dev routing and typed misses       | Implemented          | `notSuitable` preserves the original prompt for Copilot                             |
| Dynamic PowerShell authorization           | Implemented          | Exact candidate/context, trusted interactive client; not arbitrary-code containment |
| Provider flow transactions                 | Implemented          | Same-process mutation serialization, not general cross-process locking              |
| Macro capture/learning/publication         | Implemented          | Current approved checked programs only                                              |
| Plugin-local ownership/locking             | Implemented, opt-in  | One writer per workspace/profile; OS releases lock on crash                         |
| Contained execution / dependency preflight | Implemented          | No legacy runner or accepted-failure fallback                                       |
| Automations catalog                        | Existing aggregation | Provider inspection/management, not a universal run engine                          |

## Documentation status

Stable architecture now separates provider flows, checked programs, dev routing
and the independent DSL/IR design. Package/skill guidance scopes broker support
by owner. Local editable lifecycle/ownership scenes accompany the architecture.
Publication validation is tracked separately from the historical product proofs.

## Open implementation work

- Qualify VS Code and other host/platform combinations independently.
- Qualify live plugin-update compatibility and interrupted-job handoff; unit
  recovery tests and ready-artifact restart do not establish that whole journey.
- Extend effects/schemas only with their own authorization and validation work;
  All is not a write-enablement switch.
- Qualify live interaction UI before claiming it; rich forms/proposals and
  learning interactive workflows remain unsupported.
- Measure paired baseline overhead/speedup before making performance claims.
- Provider-specific follow-up remains separate: stronger PowerShell containment,
  independent agent-server storage locking and forced process-tree termination.

Explicit first-run PowerShell authorization and existing Automations aggregation
are not missing implementation items.

## Documentation follow-up

- Preserve existing URLs, including `copilot-fastActions`; no rename is needed.
- Keep package operational instructions aligned with the stable architecture.
- Recheck authority wording whenever PowerShell or program effect support changes.
- Record qualification by revision, host, date and exact scope, using public
  source/tests or self-contained summaries rather than inaccessible citations.

## Validation checklist

- [x] Program contracts and owner defaults checked against the merged source.
- [x] Historical native/production evidence separated from release gates.
- [x] Stable architecture linked from package and workflow entry points.
- [x] Macro skill distinguishes owner capabilities and accepted failures.
- [x] Regenerate navigation/package staging and validate local/published links.
- [x] Build DocFX and inspect the new diagrams and page at desktop/mobile sizes.

Documentation build: zero errors, 48 pre-existing warnings outside the updated
pages. The separate global navigation check still reports the pre-existing
unlisted `core/model-providers.md`; targeted macro-page navigation is generated.

No new product/model trial is implied by this documentation refresh. Future live
tests require an isolated synthetic workspace/store; do not open a second owner
over a running user's catalog.
