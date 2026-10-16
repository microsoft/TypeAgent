# Copilot fast actions

Status: Implemented, with follow-up work. This document is the source of truth
for the cross-package design of Copilot dev actions and tool-composed macros.
Progress and remaining work are tracked in [STATUS.md](./STATUS.md).

## Program-only critical path

Checkpoint A is the default TypeAgent-hosted read-only MCP program path, not an
opt-in alongside step macros. Both server entry points configure the checked
author, broker, semantic provider and contained executor unconditionally.
Legacy step execution, macro runner profiles/bridge, adaptation APIs and execution
flags are removed. Old test macros are discarded, not migrated.

Checkpoint B adds token-bound root success receipts, sealed explicit context,
durable scoped authoring leases, and tools-disabled native Copilot children for
extraction/build/grammar/source. TypeAgent retains source-independent verification,
compilation/fixtures, publication, matching, and execution. Its verifier responses
are durably checkpointed across child waits/restarts; native inherited-context
isolation is not assumed. The original answer does not wait for authoring.
Off/Cancel/new user work cancels only the author child. Contextual jobs have no
silent TypeAgent-author fallback; clients without contextual capture retain the
named A compatibility path. See [B lifecycle](../../../packages/copilot-macros/README.md#checkpoint-b-copilot-child-authorship)
and [verification status](./STATUS.md) for supported scope and live evidence.

Checkpoint C adds opt-in `plugin` ownership with explicit `typeagent` rollback
and `off`. The joined native extension owns the same `MacroManager`, portable
author/validator, shared action-grammar matcher and contained executor. Hooks,
commands and macro MCP tools use bounded authenticated session-local IPC; there
is no second artifact catalog or executor. A held SQLite writer lock prevents
multiple native mutation owners of one workspace/profile and releases on crash.
Unmatched requests stay in native Copilot. The independent verifier and bounded
semantics use isolated sessions on a separate installed native CLI, not inherited
author children or TypeAgent credentials. Copied compiler/worker assets are part
of the distribution. See [owner setup](../../../packages/copilot-plugin/README.md#checkpoint-c-plugin-owned-recipes)
and [verification boundaries](./STATUS.md); CLI evidence never implies VS Code support.

The program delivers A: TypeAgent recording/matching/execution; B: restricted Copilot child
authorship with TypeAgent execution; C: plugin-local ownership/standalone operation.
Host capability verification remains open for B/C, not missing A runtime
implementation. See [status](./STATUS.md) and
[runtime boundaries](../../../packages/copilot-macros/README.md#checkpoint-a-typeagent-hosted-programs).

## Purpose

Copilot fast actions let TypeAgent reuse a known procedure instead of asking
the Copilot model to plan the same work again. The area contains two related
mechanisms:

| Mechanism            | Entry point                                    | Fast path                                                                   | Learning or adaptation                                                  |
| -------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Dev actions          | Copilot `userPromptSubmitted` hook in dev mode | A registered PowerShell namespace action or dynamic flow handles the prompt | PowerShell-specific reasoning may reuse, create, or repair a flow       |
| Tool-composed macros | `typeagent-macros` MCP tools                   | An approved checked program runs in the contained executor                  | A selected recording authors and validates a program before publication |

Both mechanisms store reusable procedures, but they have different routing,
approval, execution, and platform rules. Approved macros are also published as
typed actions by the `macros` agent in agent-server. They can use normal
translation and learned grammar routing; macros are not a fourth plugin mode.

For the common TypeAgent workflow lifecycle, dynamic schema and grammar API,
and provider-specific flow formats, see
[Workflows](../../architecture/workflows/workflows.md).

## Goals

- Handle known development actions before the Copilot agent loop.
- Reuse successful procedures without repeated model planning.
- Return a clean miss when a request does not belong to the active fast-action
  surface.
- Make macro recording and approval explicit.
- Check deterministic macro requirements before invoking the first step.
- Preserve cancellation, failure, and possible-side-effect information across
  package boundaries.

## Non-goals

- A unified catalog across PowerShell, WebFlow, TaskFlow, and Excel providers.
- Deterministic replay of Copilot-native shell or edit tools.
- Unbounded semantic planning or arbitrary native-code execution on repeat.
- Treating dynamic PowerShell policy metadata as a security sandbox.
- A separate plugin routing mode for macros.

## Terminology

| Term                    | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| Dev action              | A PowerShell-family action offered first refusal in Copilot dev mode           |
| Static namespace action | A committed, typed PowerShell action implemented in a `powershell.*` namespace |
| Dynamic PowerShell flow | A persisted PowerShell recipe with generated schema and grammar                |
| Tool-composed macro     | A versioned procedure induced from one explicitly recorded Copilot tool trace  |
| Symbolic program        | Checked code performs known operations without a model                         |
| Hybrid program          | Checked code invokes only declared bounded semantic functions                  |

## System map

```text
User prompt -> dev-mode PowerShell action/flow, or
            -> explicit recording -> grounded build + grammar -> author/compile/fixtures
              -> checked draft -> publication -> current version-pinned program
              -> contained executor -> read-only MCP / declared semantic calls
```

### Approved macro action routing

The dynamic `macros` provider exposes current approved programs without secret
inputs as `run_<macroId>_v<version>` typed actions. Learning validates original/
equivalent requests, changed inputs, negative intents and combined-catalog
collisions before publication. Approval/disable/delete refresh active schemas.
Grammar hits and explicit calls share current-revision checks and program
execution. Failures are terminal; no replay, planning child or runner fallback
executes. Broader paraphrases may miss and follow normal request routing.

## Dev-action routing

`@typeagent mode dev` selects the dev-action hook. On Windows, the hook submits
the original prompt with the PowerShell schema family active.

Ordinary prompts use:

```ts
{
    activeSchemaFamilies: ["powershell"],
    noReasoning: false,
    reasoningProfile: "powershellCapabilityFallback",
}
```

The dispatcher tries registered grammar and translation first. A static
namespace action or active flow can therefore complete without a Copilot model
turn. If no direct action fits, the PowerShell capability profile may:

- use an existing static action or flow;
- add a validated grammar pattern to an existing flow;
- create and test a new flow;
- repair one stale flow once; or
- report that the request is not suitable for PowerShell.

A typed `notSuitable` outcome maps to a not-handled disposition, allowing
Copilot to process the original prompt. Once TypeAgent accepts work, failures
remain handled so Copilot does not repeat a potentially state-changing action.

Recording directives such as `learn:` use the `powershellFlowRecording`
profile. On non-Windows platforms, ordinary dev requests fall through and
explicit PowerShell recording requests return a visible unsupported-platform
message.

Cancellation after submission propagates through agent-server and dispatcher
request cancellation to the PowerShell child process. Mutating static actions
request confirmation; the unattended plugin client selects the default-deny
choice.

## PowerShell actions and flows

### Static namespace actions

Committed namespace handlers cover files, processes, system, services,
network, data, and archives. Each namespace owns an exhaustive action map.
A shared factory applies confirmation, execution, cancellation, failure
conversion, and display behavior.

### Dynamic flow lifecycle

Dynamic flows use a pending/test/promote/activate transaction:

1. Search for an existing flow with the proposed action name.
2. Validate grammar patterns.
3. Save a pending recipe.
4. Execute that recipe once.
5. Delete the pending recipe on failure or cancellation.
6. Promote the same recipe after success.
7. Reload the dynamic schema and grammar.
8. Remove the promoted flow if activation fails.

Same-name mutations are serialized within one agent-server process. A promoted
flow persists in instance storage and is available after restart. Repair is
bounded to one attempt per request and is not attempted for policy denial,
cancellation, unsafe requests, or failures that may have produced partial side
effects.

## Tool-composed macro lifecycle

Explicit session recording retains the actual successful tool trace. Learning
extracts a factual recipe, derives grounded parameters/dependencies, stages
version-targeted grammar, then authors checked TypeScript. Fixture expectations
are derived independently of candidate code; the actual executable must pass them.
Prepare stages a draft; Read-only and All may auto-publish valid local programs.
The initial broker rejects writes/native-only tools even in All.

Programs run in worker-contained QuickJS/WASM with bounded CPU/memory/stack/JSON
and broker calls. Symbolic repeats use no model; hybrid repeats invoke only
declared strict semantics through the configured TypeAgent provider. Existing
MCP trust/backend authorization remains authoritative, without extra recipe
consent or model-driven inspection. Durable journals preserve uncertain external
dispatch; cancellation cannot roll back backend work.

Grounded step/expression metadata remains authoring/audit evidence only. A
step-only definition cannot be persisted, approved or run. `ReplayToolHost`
remains the shared discovery/invocation interface, not a step executor.

## Try dev actions

Dev actions require Windows, a running agent-server, and the PowerShell agent.

```text
@typeagent mode dev
show top 5 memory hogs
```

To demonstrate learning with disposable, read-only data:

```text
learn: show the 3 newest .log files under <PATH>
@typeagent run list powershell flows
show the 3 newest .log files under <PATH>
```

The generated flow name and exact output depend on the configured model. Use
the name returned by TypeAgent instead of predicting it.

## Try a tool-composed macro

1. Select `@typeagent macro learning prepare` (or All for automatic publication).
2. Arm `@typeagent macro record`, then perform one supported read-only MCP task
   with a bounded original request, for example a quoted file path followed by
   fixed words `for me`.
3. Check `@typeagent macro status` for the saved trace and learning job outcome.
4. In Prepare, review/validate the checked candidate and call `approve_macro`.
5. Repeat a covered natural request with a changed input, or call `run_macro`
   with current approved ID/version, unique run ID and required inputs.
6. Inspect `get_macro_run` evidence. A draft must be rejected; failures never
   fall back to another execution engine.

Restart agent-server and reload the built plugin after updating; no program flag
is required. See the [recording walkthrough](../../../packages/copilot-plugin/README.md#learn-from-one-executed-task).

## Safety and trust boundaries

Static PowerShell actions contain reviewed scripts. Dynamic flows contain
generated, imported, edited, or repaired scripts. These paths do not currently
have the same trust level.

Dynamic scripts run in PowerShell `FullLanguage` mode. Cmdlet lists, path
validation, module lists, and network flags restrict common command paths, but
they do not prevent direct .NET filesystem, process, network, reflection, or
assembly APIs. Treat dynamic flow execution as host code execution, not as a
security sandbox.

Macro recording is explicit; drafts cannot run. Program validation, current
revision checks, schema/capability identity, containment and bounded semantic
declarations remain enforced. Only recording/induction startup switches remain:
`TYPEAGENT_MACRO_RECORDING_ENABLED` and `TYPEAGENT_MACRO_INDUCTION_ENABLED`.
Disable/forget an approved program to revoke its route.

## Storage

PowerShell flows live under the PowerShell area of TypeAgent instance storage.
They include an index, flow metadata, script bodies, generated grammar, and
pending recipes.

Macros use a separate `copilot-macros/` directory under agent-server instance
storage:

```text
copilot-macros/
  index.json
  traces/<traceId>.json
  macros/<macroId>/versions/<version>.json
  runs/<runId>.json
  metrics.jsonl
```

Back up these directories before migrations. Restore them only while
agent-server is stopped.

## Known limitations

- Dev actions are PowerShell-specific and Windows-only.
- Dynamic PowerShell scripts run in FullLanguage mode.
- Flow mutation locking does not coordinate separate agent-server processes
  sharing one storage directory.
- PowerShell cancellation has no forced process-tree termination fallback.
- Macro induction from a single trace is deliberately narrow.
- Native Copilot tools and writes are unsupported by the initial program broker.
- Macro catalog mutation coordination is process-local.
- Credentialed live end-to-end coverage is not yet a release gate.
- The macro catalog does not enumerate other TypeAgent workflow providers.

## Verification

| Behavior                                                         | Focused evidence                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Dev hook options, platform policy, fallthrough, and cancellation | `packages/copilot-plugin/test/hookDevActions.spec.ts`                        |
| Schema-family routing and dispositions                           | `packages/dispatcher/test/devActionRouting.spec.ts`                          |
| Flow transaction, repair, persistence, and namespaces            | `packages/agents/powershell/test/actionHandler.spec.ts`                      |
| Flow storage                                                     | `packages/agents/powershell/test/powerShellStore.spec.ts`                    |
| Macro induction and validation                                   | `packages/copilot-macros/test/macroDefinition.spec.ts`                       |
| Program preflight, actual contained execution, and fresh inputs  | `packages/defaultAgentProvider/test/checkpointAPrograms.spec.ts`             |
| Versioning, approval, suppression, restart, and durable runs     | `packages/copilot-macros/test/macroPrograms.spec.ts`                         |
| Macro MCP surface and packaging                                  | `packages/copilot-plugin/test/macroServer.spec.ts`, `pluginArtifact.spec.ts` |
| Recording RPC integration                                        | `packages/agentServer/server/test/macroRecordingRpc.spec.ts`                 |

## Key files

| Area                                 | Path                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| Dev-action hook                      | `packages/copilot-plugin/src/hooks/hook-dev-actions.ts`            |
| Hook routing and recording commands  | `packages/copilot-plugin/src/hooks/hook-router.ts`                 |
| Macro MCP adapter                    | `packages/copilot-plugin/src/mcp/macroServer.ts`                   |
| Macro contracts                      | `packages/copilot-macros/src/contracts.ts`                         |
| Induction and validation             | `packages/copilot-macros/src/macroDefinition.ts`                   |
| Macro lifecycle and persistence      | `packages/copilot-macros/src/macroManager.ts`                      |
| Contained program execution          | `packages/copilot-macros/src/recipeExecutor.ts`                    |
| MCP replay host                      | `packages/defaultAgentProvider/src/mcp/mcpReplayHost.ts`           |
| PowerShell action and flow lifecycle | `packages/agents/powershell/src/actionHandler.mts`                 |
| PowerShell store                     | `packages/agents/powershell/src/store/powerShellStore.mts`         |
| PowerShell script host               | `packages/agents/powershell/scripts/scriptHost.ps1`                |
| Capability reasoning profiles        | `packages/dispatcher/dispatcher/src/reasoning/reasoningProfile.ts` |
