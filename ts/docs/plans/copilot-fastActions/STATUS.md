# Copilot fast actions status

Working tracker for [PLAN.md](./PLAN.md). Stable contracts live in
[Checked program macros](../../architecture/workflows/macros.md) and
[provider flow architecture](../../architecture/workflows/workflows.md).
Implementation, historical test evidence, live qualification and documentation
validation are separate states.

_Last updated: 2026-10-16._

## Plugin-first program path

| Capability                     | Implementation/default                                                                       | Evidence and remaining boundary                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Checked program core           | Shared manager, authoring, compiler, publication, grammar matcher and QuickJS worker runtime | Offline suites exercise contracts and containment; not a second engine per owner                         |
| TypeAgent-hosted A             | Implemented and default                                                                      | Read-only TypeAgent MCP broker; configured verifier/semantic provider                                    |
| Native child authoring B       | Implemented for selected native learning                                                     | Root receipt, sealed context, durable leases and restricted children; native CLI synthetic proof         |
| Plugin-owned C                 | Implemented, opt-in `recipeOwner: "plugin"`                                                  | Authenticated IPC, workspace/profile writer lock and copied standalone symbolic/hybrid proof             |
| Optional TypeAgent action host | Composed into C's existing host                                                              | Real Dispatcher with synthetic read-only data and native MCP reuse; not production-service certification |
| Copilot dev actions            | Windows PowerShell first-refusal routing                                                     | Dynamic scripts still need trusted interactive authorization; model-only MCP clients fail closed         |
| Other flow providers / catalog | Existing provider stores and Automations aggregation                                         | No universal executor or plugin/server catalog synchronization                                           |

Owner `typeagent` remains the compatibility default; `plugin` and `off` are
explicit selections requiring native-session restart. Owner, routing mode and
learning preference are independent. Both current program brokers reject writes.
Only the TypeAgent-owned initial broker rejects all native-only tools: C supports
native reads and exact classified read-only MCP identities under native permission,
hooks and content exclusions.

## Revised critical path and simplification

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
