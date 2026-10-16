# @typeagent/copilot-macros

`@typeagent/copilot-macros` records, authors, validates, catalogs, matches, and
executes checked code-first macros. The plugin-local owner owns its
`MacroManager` and storage; the plugin exposes recording commands, lifecycle MCP tools, and the
[macro skill](../copilot-plugin/skills/typeagent-macros/SKILL.md).
Only checked programs can be persisted, approved, or run. The former step replay
engine, Copilot macro runner, adaptation bridge/RPCs, and execution switches have
been removed. Development-only old macro records are discarded, not migrated.
See the [cross-package plan](../../docs/plans/copilot-fastActions/PLAN.md).

## Host-independent program contracts

The `@typeagent/copilot-macros/recipeCore` entry point defines the v1
program artifact and runtime ABI, schemas, capability and semantic boundaries,
capture/jobs, catalog transactions, publication modes, effects, and migration
contracts. It imports no dispatcher, agent-server, model SDK, or configuration.
Program APIs are organized as subpath imports:

- `recipeCore`, `recipeTesting`: contracts, validation, and the offline fake host.
- `recipeCatalog`, `recipeRouting`: `DurableRecipeCatalog` SQLite persistence
  and `RecipeRouter` local grammar routing.
- `recipeAuthoring`, `recipeAuthoringCandidate`, `recipeAuthoringValidation`:
  contextual capture, candidate construction, and offline validation components.
- `recipeAuthoringStore`: `DurableRecipeAuthoringContextStore(userDataDirectory)`
  and `parseRecipeAuthoringEnvelope(text)` for immutable, scoped authoring
  envelopes that persist across restart.
- `recipeSemantic`, `recipeSemanticTesting`: typed semantic adapter components
  and injected test providers.

All names above are under `@typeagent/copilot-macros/`. Constructing the SQLite
catalog requires **Node >=22.13**; importing the core does not open a database.
Catalog data is local and scoped by workspace/profile, not synchronized or
published remotely. Live provider/account/session bindings remain separate from
durable recipe content.
Authoring-store persistence is limited to the validated envelope contract; it
does not establish retention of secrets or private raw artifact contents.

## Portable recording-to-program authoring

`macroAuthoringRuntime` exports `createMacroLearningRuntime(query,
loadApprovedMacros?, options?, programAuthor?)`, grammar validation, and authoring
evidence types. The query is required: this module never selects a TypeAgent
model or initializes its configuration. `withAuthorQuery(query, cacheVerifier?)`
redirects author queries while retaining the configured independent program
verifier and its durable cache hook.

`macroProgramAuthoring` exports `createMacroProgramAuthor(options)` and the public
fixture-plan types. Supply `query`, `verifierQuery`, `inspectCapability`, and
`semanticModelPolicy` explicitly. An optional trusted `createFixturePlan` callback
can replace verifier inference. The inspector supplies actual native or MCP
capability identities and schemas; only read-only recorded calls are accepted.
The verifier sees the recording without a prior program, never candidate source.
The candidate sees the independent specification, not the verifier's fixtures.
The shared compiler and contained executor check observed and changed-input/
fresh-result fixtures before sealing the same program artifact used at runtime.
This is an authoring/validation path, not an alternate live executor.

`macroSchema` exports the shared macro action-name and input-schema helpers.
`matchMacroGrammarInputs(macro, request)` uses the same saved action grammar and
NFA runtime with registered built-in conversions, selects the current macro's
action name/version, and returns only valid typed parameter objects. Secret-input
macros, invalid grammars, stale action names, and invalid inputs do not route.
It neither selects between catalog entries nor executes a program.

`sealRecipeArtifact` hashes and freezes an already checked source/executable
pair; it does not compile, execute, or prove the program correct. Runtime schemas
support explicit primitive types, closed objects, arrays, enums, and bounds.
Unsupported JSON Schema keywords fail validation rather than being ignored.
Capability compatibility is deliberately exact in v1.

`@typeagent/copilot-macros/recipeTesting` provides an in-memory `FakeRecipeHost`
and `runRecipeFixture` for trusted test callbacks with injected native/MCP and
semantic results. This is neither a sandbox nor a live host implementation.
Fixture callbacks do not execute the artifact's stored source or executable.
Interaction, denial, unavailable dependencies, semantic abstention, and uncertain
dispatch remain explicit outcomes; the fake never retries a call automatically.
These fake-host exports do not establish containment. Actual stored-source
compilation and execution use the separate `recipeCompiler` and `recipeExecutor`
entries described below. Checkpoint B delegates authoring queries, not execution,
to the native Copilot host as described below.

Catalog implementations must provide atomic CAS transactions, immutable content
revisions, capture deduplication, leased job ownership, and routing invalidation.
Publication metadata is separate from immutable program content. Disabled or
superseded revisions cannot start a new invocation; in-flight evidence pins its
revision and stops future calls without promising effect rollback. Credentials
and session bindings do not belong in artifacts. Source-recording provenance is retained for audit, not as an executable fallback.

## Shared checked-program core

The plugin-local owner uses this manager, authoring/compiler/runtime ABI and
grammar matcher; it does not mirror programs into the experimental SQLite
catalog. The server does not compose an alternate catalog or recording learner.
Use the plugin's normal recording/status/run commands; no program feature flag
or backend-owner fallback is needed. See [plugin ownership](../copilot-plugin/README.md).

The manager accepts an authoring profile identity (default `typeagent`) so sealed
captures/outbox claims remain scoped under plugin-local profiles. Native
inspection is opt-in through `ReplayToolHost.supportsNativeTools`.
`close()` stops new runs, cancels active work,
waits for journals/catalog mutations, and leaves interrupted learning queued with
its stage attempt refunded for a new owner. Cancellation is reserved before
asynchronous route loading and may precede acceptance; it never rolls back effects.
Equivalent active or successful recordings share a learning job. After a failed
job, a fresh sealed child capture creates a new job with its own immutable
provenance; resubmitting the same trace does not automatically retry it. The
original failure remains inspectable, and disabled/forgotten work stays suppressed.

The production author derives fixture expectations independently of candidate
source, compiles TypeScript, executes the stored executable against strict
fixtures, and seals the artifact before publication. Program authoring has a
120-second stage deadline; other model-learning stages retain their existing
30-second deadlines. `All` publishes valid local candidates without a new
recipe-layer consent prompt; `Prepare` still stages them, and `Read-only`
checks actual tool descriptors.

Grammar and explicit program invocation resolve the current approved revision
through the same manager path. They run stored code directly, not the planning
runner or a legacy-step fallback. Symbolic execution uses no model. Hybrid
execution calls only declared semantic functions through an injected typed
provider, with strict schemas, bounded attempts, cancellation, and actual model/
token evidence. The source author query always uses the restricted Copilot child;
independent verification and semantic policy configuration do not select another
author.
Declarations requiring custom source-ID/quotation provenance validators are not
auto-published by the initial author: they fail validation before publication,
rather than producing a ready program that cannot run.

Host adapters validate schemas and pin actual native or MCP descriptor identities
as well as normalized runtime schema digests. Unsupported schema constraints,
missing tools, and effects outside the host's supported policy fail explicitly
rather than substituting another execution path. Optional TypeAgent business
actions retain their MCP trust and backend authorization. There is no step replay
or runner fallback.

`recipeCompiler` performs TypeScript diagnostics and produces the checked
executable. Execution verifies compiler/source/output identity using a bounded
in-process cache; first use after restart or cache eviction can recheck compilation.
`recipeExecutor` runs it in a worker-contained QuickJS/WASM guest
without Node authority. Standalone defaults are 5 seconds, 16 MiB guest memory,
256 KiB stack, 64 broker calls, and 1 MiB JSON; TypeAgent program runs use a
deadline capped at 60 seconds. Limits have explicit ceilings and cancellation
terminates the worker. Cancelling external work is not rollback: the backend may
finish a dispatched request after cancellation.

Run journals persist dispatched/completed/uncertain checkpoints before subsequent
calls. Disabling or superseding a revision stops future calls, not completed
effects. Interrupted journals retain evidence for inspection; continuation is not
implemented. Exact outcomes and semantic usage remain in `MacroRunRecord.program`;
private outputs use the existing bounded result/evidence handling. Program
dry-run is explicitly unsupported and dispatches nothing.

## Lifecycle

```text
arm -> claim -> finalize actual trace -> grounded build + staged grammar
     -> author source + independently derived fixtures -> compile + execute fixtures
     -> persist checked draft -> approve immutable revision -> run stored program
```

Recording is explicit and session-scoped. Prepare stages a draft; Read-only and
All can publish validated local successes. Drafts and disabled versions cannot
run. Approval writes a new immutable version and checks the combined current
grammar catalog. The grammar targets that anticipated approved version, not the
authoring draft version.

Grounded `MacroStep`, `ValueExpression`, execution-class and postcondition
metadata remain as authoring/audit evidence. `replayable` means the captured tool
was inspectable by TypeAgent; `agentRequired` denotes an unavailable capability.
Neither selects an execution mode. Unavailable capabilities fail
program authoring; they cannot launch a runner.

`induceMacroFromTrace` derives parameter bindings and observed result dependencies
without invoking tools. Builders must preserve captured call identities/order,
reconstruct example arguments exactly, and report unsupported work. The production
author resolves supported requirements as checked code or bounded semantics.

## Natural-language action integration

The plugin-local owner exposes current approved programs without secret inputs
through its grammar and explicit MCP routes. Learning stages and validates grammar
before publication. Grammar and explicit
`runMacro` calls use one program invocation path and reject stale approvals,
disabled routes, duplicate run IDs, and invalid inputs. No model-led inspection,
planning child, extra recipe-layer consent, or automatic execution retry is added.
Existing MCP trust and backend authorization remain authoritative.

## Checkpoint B: Copilot child authorship

The native extension selects contextual authorship for claimed learning
recordings. The parent explicitly attests successful completion through
`typeagent_recorded_task_succeeded` before its final answer. The capture binds
the actual root receipt, user event, final output, prompt hash, and recording
token. Idle, one successful tool, an aborted task, or a child's completion is
not sufficient. This attestation is not a substitute for program validation.

TypeAgent seals the redacted task-scoped context and persists the job before
acknowledging finalization. Scoped phase prompts are durably queued in
`child-authoring.json`; `awaitingAuthor` is a recoverable state, not a failed
model attempt. Claims bind workspace, host session, worker, exact prompt digest,
and a two-minute lease. Responses are immutable and bounded. Missing/changed
context and late or mismatched submissions fail explicitly.

The extension answers extraction, generalization, grammar, and source queries
using fresh tools-disabled native `task` children. Children receive the explicit
sealed context and phase request, cannot execute business tools or delegate,
and do not block delivery of the original answer. Private output references are
scoped; verified redacted model-visible evidence is supplied in phase prompts,
not fetched by giving the child filesystem or credential access.

Native inherited-context isolation is not assumed. The independent,
source-blind fixture verifier uses its independently configured query provider.
Its successful responses and completed build/grammar stages are
checkpointed so a pause/restart does not regenerate the validation oracle or
exhaust a restart budget. The shared core compiles, runs independent fixtures,
applies existing publication modes, stores, matches, and executes the program.
Repeat-time symbolic/semantic behavior is unchanged.

New user work preempts only the active author child. Off/Cancel stops pending
work and aborts an active child; host shutdown leaves unanswered leases
recoverable by a later compatible session. No work is promised while Copilot is
closed. All learning requires correlated `childAuthoring` and a sealed context;
there is no backend, offline, or missing-envelope author fallback.
Trace-only recordings remain nonlearning and cannot later be induced from logs.

## Durable learning

Learning is opt-in and uses an injected `MacroLearningRuntime`; this package has
no model or SDK dependency and never launches a learning agent or calls task
tools. The service supplies factual `extract`, generalized `build`, and checked
`generateGrammar` implementations plus a required `buildProgram` author. Each receives an abort signal. A synchronous
`validateGrammar(macro, approved)` implementation rechecks the staged rules
against the current approved catalog inside serialized approval and recovery.
This validation must not generate rules or execute task tools. The injected
runtime must implement `withAuthorQuery` to bind every author stage to the
restricted child query. The independent verifier and declared typed semantic
calls remain separate from that author query. The runtime must not have
task-execution capabilities. It must report unsupported
selection, synthesis, or full-output requirements in
`MacroLearningBuild.unsupportedOutputs`; a structurally valid, warning-free
procedure is not proof that it reproduces the complete answer. Grammar syntax,
action-version targeting, original-request coverage, and negative-intent checking
belong to the injected grammar generator/compiler, not string validation here.

An extraction may preserve explicit semantic interpretation or JSON-output
obligations as optional `MacroExecutionRecipe.programRequirements` when the
completed reads and final response exist but their private bodies are withheld
from the extractor. This is not a correctness verdict. The portable runtime
deterministically retains every obligation in `unsupportedOutputs`, including
after a grounding correction, even if the builder omits it. Each becomes a
mandatory independent program-verifier output requirement with observed and
fresh expected-output evidence. Failed/missing calls, absent responses, unknown
resources and unrecorded effects remain blocking `uncertainties`; deferred
obligations never override them or authorize another tool/effect.

`parseMacroExecutionRecipe(value: unknown)` and
`parseMacroLearningBuild(value: unknown)` are exported for model JSON ingestion
without caller casts. They reject malformed/unsupported fields, unsafe paths,
invalid expression/guard types, secrets, and oversized values. Parsing preserves
canonical request text and uncertainty/unsupported-output reports; it does not
establish trace provenance or output support. The manager still performs grounded
validation against the recorded interaction. Build requests must contain the
exact original request plus 3-5 distinct variants (4-6 total); case/whitespace-only
duplicates do not count as variants.

```typescript
await manager.configureLearning(runtime);
await manager.setMacroLearningPreference({ cwd, mode: "prepare" });
const token = manager.armRecording({ sessionId, cwd, learning: true });
// Claim and finalize with childAuthoring from the actual root user,
// token-bound success receipt, and final-answer event identities.
// finalizeRecording returns learningJobId without waiting for model work.
const job = await manager.getMacroLearningJob(summary.learningJobId!);
```

The public coordinator API is:

- `configureLearning(runtime)`: load durable preferences/jobs and resume queued
  or interrupted stages. Saved-but-refresh failures are retried on configuration
  without repeating completed model stages.
- `getMacroLearningPreference(cwd)` / `setMacroLearningPreference({cwd, mode})`:
  durable workspace-scoped preferences with monotonically increasing revisions.
  Working directories are resolved and case-normalized for Windows. Load or set
  the preference before the synchronous selected `armRecording` call.
- `prepareMacroLearning({traceId})`: reprocess a previously sealed child capture
  and return without waiting for extraction, building, or grammar generation.
  Missing or mismatched sealed context requires re-recording.
- `getMacroLearningJob(jobId)`: inspect persisted phase, macro reference, or error.
- `await getRecordingState(sessionId)`: inspect recording state and, after a
  selected recording completes, its current learning job, phase, version, or
  error. Cancellation clients use this job ID before clearing the recording.
- `cancelMacroLearningJob(jobId)`: persist cancellation and abort active work.
  Already approved macros must instead be disabled or forgotten.

The four modes are `off` (default, no selected recording or preparation),
`prepare` (stage a draft for explicit approval), `read-only` (auto-approve only
when every supported step's inspected descriptor explicitly has `readOnly: true`), and
`all` (auto-approve valid procedures within the host's supported effect policy).
Uninspectable tools are not classified as read-only; native inspection requires an
explicitly capable host. Recording and induction must be enabled for selected
learning. Publication mode never overrides host authorization. Manual recording without
`learning: true` stores a trace only; it never queues learning or fabricates child
provenance. A preference change to Off
cancels pending work; preference/flags are checked again before publication.
Changing a learning preference does not revoke an already approved definition.

Learning accepts only complete successful, non-secret traces, preserves the
canonical request and all source call identities/order, and requires exact
argument reconstruction from the example inputs and recorded results. Invented
steps/tools, unknown expressions, unsafe paths, unused inputs, overlapping
bindings, invalid result guards, and unresolved recipe uncertainties fail before
publication. Inputs may generalize evidenced argument values; these checks do not
prove semantic wildcard safety or goal-level synthesis.

Learning baselines use captured model-facing results where available. These
ground dependencies and independently derived fixture expectations; they do not
execute recorded steps on repeat. Grammar, request examples, workspace, job and
publication preference persist with immutable versions for restart-safe routing.

`prepareMacroLearning({traceId})` uses the same pipeline for an existing complete
trace with its genuine sealed child context, without rerunning the original task.
Persisted jobs lacking valid child identity or their exact sealed context are
marked failed with an explicit re-record diagnostic on load, not resumed.
There is no runner adaptation or
candidate-submission overload; record a new successful example for a new procedure.
Disable/forget suppress equivalent learned observations from resurrecting a macro.

Jobs and preferences are atomically persisted in the manager's learning state.
One worker runs at a time, with at most 32 pending and 1,000 retained jobs,
100 calls/inputs per artifact, 256 KiB validated JSON values, depth 30, 20,000
JSON nodes, six grammar/request variants, 16 MiB durable learning storage, and
two attempts per model stage across restarts. Model stages have a 30-second
deadline; metadata inspection and catalog refresh have 10-second deadlines.
Failures are inspectable and persisted; a saved catalog whose refresh fails is
reported as saved-but-not-refreshed, not success. Storage failures are surfaced
on status reads. The service should configure one manager per storage directory;
cross-process worker leases are not provided.

### Private full-result evidence and derived item paths

Selected capture submits original result values to the manager; ordinary histories
and inline small v1 evidence remain redacted. The manager privately retains large
results and any inline `base64Content` in exclusive, lossless UTF-8 JSON sidecars
under its existing instance root. A v2 trace declares exactly
`["private-result-evidence-v1"]`; each source reference binds owner ID, call ID,
`result` versus actual captured `modelResult`, JSON digest/size, sensitive status,
bounded redacted view, omitted paths and decoded original-blob digest/size.
The original base64 (including all DOCX media) is preserved, not replaced with
extracted text. This is an audit representation, not a DOCX semantic parser.

Each sidecar is capped at 16 MiB; each projected result view at 32 KiB. Base64
bodies and strings over 4,096 characters are explicitly archived. The existing
256-KiB learning and 1-MiB stored-trace caps remain unchanged. Oversized views or
missing/invalid evidence fail, never truncate or return success-shaped metadata.
References carry no caller filesystem path or public read capability. Loading
checks ownership, supported encoding, canonical JSON/base64, declared size,
digests, projected view/receipts, ancestor containment, symlinks and hard links.
The configured storage root's parent is canonicalized to support system path
aliases (including macOS temporary directories and Windows short paths).
The storage root itself and every descendant must remain unlinked.
All references are verified again when loading after restart. Callers cannot
submit artifact references as capture evidence. Replay step/final results use
the same lossless retention rather than oversized-result previews.

The local-only `PrivateResultStore.verify` returns original JSON for an independent
audit oracle; no MCP inspection tool returns its bodies. The caller supplies only
host-owned identity, not a filename. Retention follows existing private instance
storage and ACL ownership; immutable trace/run evidence is not automatically
evicted. Review retention before admitting sensitive captures.

Learning uses explicitly identified projections, not invented model-visible
receipts. It cannot bind to archived body paths or their ancestors, or infer body
guards from omitted data. Actual SDK model-facing content and raw tool results
are retained separately when observed. This does **not** change upstream CLI tool
rendering, prove the SDK delivered full bytes, prevent pre-capture model exposure,
or claim a model semantically read a binary. Those native gates require real
verification.

Grounded metadata needing derived remote item paths uses schema 2 with exactly
`["result-path-v1"]`. The `resultPath` expression supports only a captured relative
`/drives/<drive-id>/items/<item-id>` base plus `/content` or a bounded `?$select=`
suffix. Unsafe paths, encoded separators, traversal and arbitrary interpolation
are rejected during grounding. This authoring representation is not a second
runtime; the checked program must implement and fixture-test the procedure.
Trace artifact schema/capabilities remain independently validated.

Idempotency is workspace + source trace, with equivalent observed operations
deduplicated by canonical request and ordered tool identities/arguments before
model work (result bodies, call IDs, and session timestamps do not create another
job). Cancellation does not silently retry. Disable/forget persist suppression
before catalog removal, so equivalent observations cannot resurrect a macro
after restart. Forget removes a learned macro from the active catalog while
retaining immutable versions and suppression evidence. Capacity failures are explicit rather than
evicting suppression history.

`onCatalogChanged()` lets providers refresh active session schemas after
successful mutations. A refresh failure is reported explicitly even though the
catalog has already been saved. Schema source/action fingerprints reconcile
learned rules when a route is removed or replaced.

Every invocation validates the authoritative current approved version, even when
called explicitly. The optional cancellation signal reaches the contained executor
and broker. A stored historical approval is audit evidence, not an execution route.

## Persistence

`MacroManager` stores data under the supplied agent-server instance directory:

```text
copilot-macros/
  index.json
  traces/<traceId>.json
  macros/<macroId>/versions/<version>.json
  runs/<runId>.json
  metrics.jsonl
```

Version and catalog writes use temporary files and rename where atomic
replacement is required. Catalog mutations are serialized within one process;
the package does not provide a cross-process storage lock.

## Privacy and persisted data

Trace persistence redacts values whose keys look like credentials and common
inline token formats. Persisted run inputs, step results, and final results use
the same redaction. Large run values are replaced with a bounded preview.

This filtering is defense in depth, not a secret-management boundary. Tool
outputs may contain sensitive values that do not match the current patterns.
Callers should limit what they record and which tool results they persist.

## API

The package exports contracts, `MacroManager`, grounded induction/validation,
`MacroExpressionError`, expression/input helpers, and trace redaction.
Program compiler/executor/catalog/semantic APIs use the subpaths above.
TypeAgent configures the concrete broker, author and program runtime in
[macroProgramRuntime.ts](../defaultAgentProvider/src/macroProgramRuntime.ts).
The retained `ReplayToolHost` interface names the shared MCP discovery/invocation
boundary; it no longer implies a step execution engine.

## Integration points

| Area                              | Location                                                   |
| --------------------------------- | ---------------------------------------------------------- |
| Recording and macro RPC contracts | `packages/agentServer/protocol/src/protocol.ts`            |
| Agent-server ownership            | `packages/agentServer/server/src/`                         |
| MCP adapter                       | `packages/copilot-plugin/src/mcp/macroServer.ts`           |
| Recording hooks                   | `packages/copilot-plugin/src/hooks/`                       |
| Macro skill                       | `packages/copilot-plugin/skills/typeagent-macros/SKILL.md` |
| MCP replay host                   | `packages/defaultAgentProvider/src/mcp/mcpReplayHost.ts`   |

## Build and test

From `ts/packages/copilot-macros`:

```bash
pnpm run build
pnpm run test
pnpm run prettier
```

The focused specs cover definition and validation, contained program execution,
catalog lifecycle, approval, persistence, cancellation, schema drift, and
run-record sanitization.

## Limitations

- Single-trace induction is deliberately narrow.
- Copilot-native tools and writes are unsupported by the initial production broker.
- This package does not provide a catalog over PowerShell, WebFlow, TaskFlow,
  or Excel procedures.
- Catalog mutation coordination is process-local.
- Pattern-based redaction cannot prove that arbitrary tool output contains no
  sensitive data.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
