# @typeagent/copilot-macros

`@typeagent/copilot-macros` is the internal engine for TypeAgent
tool-composed macros. It defines recorded Copilot tool traces, macro
definitions, validation, immutable lifecycle operations, deterministic MCP
replay, agent-runner handoff payloads, redaction, and persisted run evidence.

The package does not expose an MCP server or launch Copilot by itself.
Agent-server owns the `MacroManager` instance and its storage. The Copilot
plugin exposes the lifecycle through
[`macroServer.ts`](../copilot-plugin/src/mcp/macroServer.ts), a macro skill, and
the TypeAgent Macro Runner agent.

For the cross-package request flow and its relationship to PowerShell dev
actions, see the
[Copilot fast actions plan](../../docs/plans/copilot-fastActions/PLAN.md).

## Lifecycle

```text
arm -> claim -> finalize trace
               |
               v
          induce draft v1
               |
          validate + review
               |
         approve as version 2
               |
     replay or agent-runner handoff
```

Recording is explicit and scoped to one session. Only one recording token can
be active for a session, and tokens expire if they are not claimed. A finalized
trace is redacted before it is persisted.

`createMacroFromTrace()` always creates a draft. Draft and disabled versions
cannot run. `approveMacro()` validates the draft and writes a new immutable
approved version rather than changing the draft in place.

## Core model

The public contracts in `src/contracts.ts` include:

| Type                       | Purpose                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| `RecordedInteractionTrace` | One completed Copilot interaction and its correlated tool calls             |
| `CopilotToolMacro`         | A versioned macro definition, inputs, steps, provenance, and state          |
| `MacroInput`               | A required or optional caller-supplied value, including secret inputs       |
| `MacroStep`                | One captured tool call and its argument expression                          |
| `ValueExpression`          | A literal, caller input, prior-step result, or template containing bindings |
| `MacroPostcondition`       | A result-type or required-result-path check                                 |
| `MacroValidationReport`    | Errors and warnings produced before approval                                |
| `MacroRunRecord`           | Sanitized evidence from one deterministic run                               |
| `ReplayToolHost`           | The host interface for tool inspection and invocation                       |

Each macro and step has an execution class:

- `replayable`: TypeAgent's replay host inspected and found the named MCP tool
  when the draft was created.
- `agentRequired`: the step needs Copilot's live tool and permission surface.

Execution class is selected for the whole macro. A run never replays a prefix
before handing later steps to the agent.

## Induction boundaries

`induceMacroFromTrace()` performs a narrow, deterministic conversion. It can:

- turn string values that also appear in the recorded prompt into inputs;
- turn redacted leaves into required secret inputs;
- bind a later argument to an exact value found in a prior tool result; and
- infer the result type and up to 50 result paths as postconditions.

It does not infer arbitrary semantic parameters, loops, branches, or a
generalized program from one example. Induction is asynchronous: calls with an
MCP server name are inspected through the supplied replay host using the
recorded working directory. Only tools available to that host are classified
as replayable. Native calls, missing servers or tools, and calls without a
configured replay host are classified as agent-required. The captured server
and tool names are preserved for the agent runner.

An MCP server name alone does not establish replayability. For example,
`github-mcp-server/web_search` may be available in Copilot but not in
TypeAgent. Such a call produces an agent-required draft with a review warning,
not an unapprovable replayable draft. Connection, authentication, and tool-list
errors still fail draft creation; they are not treated as absent capabilities.
Unreadable configuration files and invalid entries for the requested server
also fail discovery rather than silently selecting the agent runner.
Inspection does not invoke the recorded tools.

## Validation and approval

Validate a draft before asking the user to approve it. Validation checks macro
structure, expressions, step ordering, trace provenance, and execution
classes.

When a replay host is configured, approval inspects every replayable tool and
records its schema fingerprint. Approval then writes the next version with
state `approved`. Disabling an approved macro also writes a new version.
Agent-guided adaptations are saved as separate drafts.

Classification does not silently change during approval or execution. A
replayable tool disappearing after draft creation still blocks approval, and
existing approved replayable macros retain their preflight checks. To correct
an older draft that misclassified a Copilot-only MCP tool, create a new draft
from its original trace, review it, and explicitly approve it. Existing
versions are not rewritten.
Tool inspection refreshes the connected server's advertised catalog, so draft
creation cannot leave approval or replay checking a stale tool schema.

## Deterministic replay

Replay preflights the complete macro before invoking step one:

1. The version must be approved and replayable.
2. Required inputs must exist and match their recorded value types.
3. Every referenced input must be bound.
4. Every tool must be available through the replay host.
5. Recorded schema fingerprints must match the current tool schemas.

A failed preflight, including `schemaDrift`, invokes no tools. After preflight,
steps execute in order. Template expressions resolve caller inputs and prior
step results immediately before each call. Postconditions validate result
types and required paths.

The caller supplies an `AbortSignal`. `MacroManager` also enforces a bounded
timeout, records cancellation or failure, and persists a sanitized run record.

## Agent-guided execution and adaptation

If a macro is `agentRequired`, or the caller selects the `agent` preference,
`MacroManager.runMacro()` returns an `AgentRunnerLaunchPayload`. The payload
contains the approved macro, supplied inputs, handoff reason, execution
budgets, and candidate provenance. The package does not launch the runner.
The runner inherits available Copilot tools, including MCP tools outside
TypeAgent's replay host, subject to live permissions. Its instructions restrict
tool use to the approved procedure, inspection, required discovery, and
successful candidate submission. An unavailable or denied tool stops the run;
the runner does not install tools or change permissions.

After a successful agent-guided run, `submitMacroCandidate()` can save an
adapted procedure. It verifies handoff identity, source version, execution
outcome, and budget use before writing a new draft. It never changes or
approves the source macro.

## Natural-language action integration

Agent-server shares this manager with the dynamic `macros` provider in
[`defaultAgentProvider`](../defaultAgentProvider/src/macroAgentProvider.ts).
Current approved macros without secret inputs become typed, version-pinned
actions. Existing dispatcher translation and learning can create grammar routes;
legacy manual approval itself does not generate a grammar. Replay and runner-handoff flags
filter the available actions and are rechecked at execution.

## Durable learning

Learning is opt-in and uses an injected `MacroLearningRuntime`; this package has
no model or SDK dependency and never launches a learning agent or calls task
tools. The service supplies factual `extract`, generalized `build`, and checked
`generateGrammar` implementations. Each receives an abort signal. The injected
runtime must not have task-execution capabilities. It must report unsupported
selection, synthesis, or full-output requirements in
`MacroLearningBuild.unsupportedOutputs`; a structurally valid, warning-free
procedure is not proof that it reproduces the complete answer. Grammar syntax,
action-version targeting, original-request coverage, and negative-intent checking
belong to the injected grammar generator/compiler, not string validation here.

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
// Claim and finalize the selected actual interaction normally.
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
- `prepareMacroLearning({traceId})`: enqueue a previously captured interaction
  and return without waiting for extraction, building, or grammar generation.
- `getMacroLearningJob(jobId)`: inspect persisted phase, macro reference, or error.
- `cancelMacroLearningJob(jobId)`: persist cancellation and abort active work.
  Already approved macros must instead be disabled or forgotten.

The four modes are `off` (default, no selected recording or preparation),
`prepare` (stage a draft for explicit approval), `read-only` (auto-approve only
when every MCP step's inspected descriptor explicitly has `readOnly: true`), and
`all` (auto-approve valid procedures regardless of effects). Native or unknown
tools are not classified as read-only. Recording, induction, and live handoff
feature flags must all be enabled for selected learning. Manual recording without
`learning: true` retains its existing behavior. A preference change to Off
cancels pending work; preference/flags are checked again before publication.
Changing a learning preference does not revoke an already approved definition.

Learning accepts only complete successful, non-secret traces, preserves the
canonical request and all source call identities/order, and requires exact
argument reconstruction from the example inputs and recorded results. Invented
steps/tools, unknown expressions, unsafe paths, unused inputs, overlapping
bindings, invalid result guards, and unresolved recipe uncertainties fail before
publication. Inputs may generalize evidenced argument values; these checks do not
prove semantic wildcard safety or goal-level synthesis.

The runtime receives the anticipated approved artifact (`draft.version + 1`,
initially version 2) for grammar generation. Rules, example inputs, requests,
workspace, job, approval mode, and `requiresLivePermissions: true` are persisted
in immutable learning metadata. Prepare mode stages the same rules for later
explicit version-2 approval. `getApprovedMacros()` returns these complete
artifacts so the service/provider can register schema and grammar together.
Every learned macro uses the whole live runner even when technically replayable;
explicit `preference: "replay"` is rejected centrally. Disabling live handoff
blocks execution. Learning approval never grants future tool permissions.
Learning metadata centrally forces the effective execution preference to `agent`;
the handoff flag, not the replay flag or technical execution class, controls
availability. The injected generator returns pre-approval rules, not an installer.
The provider can return all approved stored rules as dynamic grammar; immutable
artifact persistence supplies restart persistence.
Legacy definitions without learning metadata retain their replay behavior.
Adaptations of learned macros require a fresh grounded build and version-targeted
grammar, rather than inheriting stale grammar from the previous version.

### Converged historical and runner evidence

`prepareMacroLearning({traceId})` accepts an existing, completed persisted trace,
including verified historical recordings. It uses the same extraction, grounded
build, policy checks, grammar generation, and durable job machinery as selected
live recording; no historical task is rerun.

Runner adaptations use the compatible overload
`submitMacroCandidate(request: EvidencedMacroCandidateRequest): Promise<MacroLearningJob>`.
The request extends the existing candidate payload with required `traceId` and
`exampleInputs`. Capture must set `RecordedInteractionTrace.handoffRunId` to the
actual runner launch run ID, preserve the canonical user request, and finalize
the actual execution before submitting the candidate. The manager verifies the
recorded handoff, workspace, timestamps, execution budgets, completed calls,
exact tool identities/order, and example-input reconstruction. Each handoff is
bound to one immutable recorded trace. Counters or proposed steps alone are not
execution evidence; a source macro cannot stand in for the new run.

Evidenced submissions enqueue and return without waiting for model work.
The coordinator extracts/builds again from the new verified trace, not from a
proposed procedure or fabricated results. Selected recording, later submission,
and historical preparation of that runner trace converge on the same job.
The adaptation retains the source macro ID and provenance, writes a new immutable
draft/approved version pair, and generates grammar for that pair's anticipated
approved version (for example, source v2 -> draft v3 -> approved v4).
The prior approved route stays active while a Prepare adaptation awaits review;
publication replaces it with one current approved artifact, not a competing
catalog entry. Disable/forget suppress every learned version of that macro,
including older pinned approvals. Legacy submissions without `traceId` retain
their explicit draft-return behavior; learned sources require the evidenced
overload rather than that compatibility producer.

The factual recipe contains source trace/call IDs, the canonical request,
description, and uncertainty, not copied raw result bodies. The injected runtime
owns model-facing evidence selection; the manager retains the actual redacted
trace locally for exact validation. Verified execution still does not prove
goal-level selection, synthesis, or complete-answer generalization. Unsupported
full outputs must be reported and rejected, never invented as observed evidence.

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

Idempotency is workspace + source trace, with equivalent observed operations
deduplicated by canonical request and ordered tool identities/arguments before
model work (result bodies, call IDs, and session timestamps do not create another
job). Cancellation does not silently retry. Disable/forget persist suppression
before catalog removal, so equivalent observations cannot resurrect a macro
after restart. Forget removes a learned macro from the active catalog while
retaining its immutable versions and suppression evidence; legacy forget keeps
its existing deletion behavior. Capacity failures are explicit rather than
evicting suppression history.

`onCatalogChanged()` lets providers refresh active session schemas after
successful mutations. A refresh failure is reported explicitly even though the
catalog has already been saved. Schema source/action fingerprints reconcile
learned rules when a route is removed or replaced.

`runMacro(request, { requireLatestApproved: true, signal })` is used for routed
execution. It rejects a superseded approved version and propagates cancellation
to replay. Explicit calls without `requireLatestApproved` preserve existing
approved pinned-version behavior. Agent-required runs validate inputs before
returning a whole-procedure launch; the caller remains responsible for invoking
Copilot's runner and observing its actual outcome.

## Persistence

`MacroManager` stores data under the supplied agent-server instance directory:

```text
copilot-macros/
  index.json
  traces/<traceId>.json
  macros/<macroId>/versions/<version>.json
  runs/<runId>.json
  handoffs/<runId>.json
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

The package exports:

- contracts from `contracts.ts`;
- `inspectReplayTools()`, `replayMacro()`, and `ReplayValidationError`;
- `induceMacroFromTrace()` and `validateMacro()`;
- `MacroManager`; and
- `redactTraceValue()`.

Minimal setup:

```ts
import { MacroManager, type ReplayToolHost } from "@typeagent/copilot-macros";

const replayHost: ReplayToolHost = {
  async inspectTool(serverName, toolName) {
    // Return the current descriptor from the host's MCP catalog.
    return undefined;
  },
  async callTool(serverName, toolName, args, signal) {
    // Invoke the MCP tool and return its structured result.
    throw new Error("Provide a ReplayToolHost implementation.");
  },
};

const manager = new MacroManager(instanceDirectory, replayHost);
```

TypeAgent's concrete MCP replay host lives in
`packages/defaultAgentProvider/src/mcp/mcpReplayHost.ts`.

## Integration points

| Area                              | Location                                                         |
| --------------------------------- | ---------------------------------------------------------------- |
| Recording and macro RPC contracts | `packages/agentServer/protocol/src/protocol.ts`                  |
| Agent-server ownership            | `packages/agentServer/server/src/`                               |
| MCP adapter                       | `packages/copilot-plugin/src/mcp/macroServer.ts`                 |
| Recording hooks                   | `packages/copilot-plugin/src/hooks/`                             |
| Macro skill                       | `packages/copilot-plugin/skills/typeagent-macros/SKILL.md`       |
| Macro runner                      | `packages/copilot-plugin/agents/typeagent-macro-runner.agent.md` |
| MCP replay host                   | `packages/defaultAgentProvider/src/mcp/mcpReplayHost.ts`         |

## Build and test

From `ts/packages/copilot-macros`:

```bash
pnpm run build
pnpm run test
pnpm run prettier
```

The focused specs cover definition and validation, deterministic replay,
catalog lifecycle, approval, persistence, cancellation, schema drift, and
run-record sanitization.

## Limitations

- Single-trace induction is deliberately narrow.
- Copilot-native tools require agent-guided execution.
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
