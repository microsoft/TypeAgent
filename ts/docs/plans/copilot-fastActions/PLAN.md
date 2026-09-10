# Copilot fast actions

Status: Implemented, with follow-up work. This document is the source of truth
for the cross-package design of Copilot dev actions and tool-composed macros.
Progress and remaining work are tracked in [STATUS.md](./STATUS.md).

## Purpose

Copilot fast actions let TypeAgent reuse a known procedure instead of asking
the Copilot model to plan the same work again. The area contains two related
mechanisms:

| Mechanism | Entry point | Fast path | Learning or adaptation |
| --- | --- | --- | --- |
| Dev actions | Copilot `userPromptSubmitted` hook in dev mode | A registered PowerShell namespace action or dynamic flow handles the prompt | PowerShell-specific reasoning may reuse, create, or repair a flow |
| Tool-composed macros | `typeagent-macros` MCP tools | An approved replayable macro invokes its MCP steps in order | An explicit trace creates a draft; agent-guided execution may submit a new draft |

Both mechanisms store reusable procedures, but they have different routing,
approval, execution, and platform rules. Macros are tools available alongside
prompt routing; they are not a fourth plugin mode.

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
- General semantic program induction from one recorded interaction.
- Treating dynamic PowerShell policy metadata as a security sandbox.
- A separate plugin routing mode for macros.

## Terminology

| Term | Meaning |
| --- | --- |
| Dev action | A PowerShell-family action offered first refusal in Copilot dev mode |
| Static namespace action | A committed, typed PowerShell action implemented in a `powershell.*` namespace |
| Dynamic PowerShell flow | A persisted PowerShell recipe with generated schema and grammar |
| Tool-composed macro | A versioned procedure induced from one explicitly recorded Copilot tool trace |
| Deterministic replay | TypeAgent executes a fixed, validated sequence of replayable MCP calls |
| Agent-guided execution | The Copilot macro runner executes the whole procedure through the live tool and permission surface |
| Automatic selection | `run_macro` chooses replay or agent handoff from the approved macro's execution class |

## System map

```text
User prompt
  |
  +-> dev-mode hook
  |     +-> registered PowerShell action/flow -> handled result
  |     +-> PowerShell capability reasoning -> reuse/create/repair/decline
  |     +-> not suitable -> Copilot continues
  |
  +-> Copilot tool use
        +-> explicit recording -> trace -> draft -> approval
        +-> approved replayable macro -> full preflight -> MCP replay
        +-> agent-required macro -> bounded Copilot runner handoff
```

Dev actions can intercept the root prompt. Tool-composed macros are invoked
through MCP tools after Copilot selects or is asked to use them.

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

### Capture

`@typeagent macro record` arms exactly one eligible Copilot interaction. The
plugin claims the recording before the turn, associates tool calls by ID, and
finalizes a redacted trace after the turn completes. Recording is explicit and
expires if the armed interaction is not claimed in time.

### Induction

`create_macro_from_trace` creates draft version 1. Current induction can:

- replace prompt-mentioned string leaves with inputs;
- create secret inputs for redacted leaves;
- bind a later argument to an exact value found in an earlier result; and
- infer result-type and result-path postconditions.

It does not infer arbitrary semantics, loops, branches, or a generalized
program from one example.

Calls that identify an MCP server are classified as `replayable`. Calls
without one are `agentRequired`.

### Validation and approval

Drafts cannot run. Validation checks macro structure, bindings, trace
provenance, and execution classes. Approval is explicit and creates a new,
immutable approved version. When a replay host is configured, approval also
records the current schema fingerprint for each replayable tool.

```text
captured trace -> draft v1 -> validation -> approval -> approved v2
```

### Deterministic replay

Before step one, replay checks the entire macro:

- the version is approved and replayable;
- every required input exists and has the expected type;
- every input reference is bound;
- every tool is available; and
- recorded schema fingerprints still match.

A failed preflight, including `schemaDrift`, invokes no steps. After preflight,
steps run in order. Arguments may include literals, caller inputs, or values
from prior step results. Postconditions check result types and required paths.
Cancellation and timeout stop the run and are recorded in the sanitized run
record.

### Agent-guided execution

If the macro is `agentRequired`, or the caller requests the `agent`
preference, `run_macro` returns an `AgentRunnerLaunchPayload`. The
`typeagent-macro-runner` executes the whole macro through Copilot's live tools
and permission surface. Replay never executes a prefix before handing off the
remainder.

A successful adaptation may call `submit_macro_candidate`. Agent-server checks
the handoff provenance and execution budgets before saving a separate draft.
It does not mutate or approve the source version.

## Execution selection

| Condition | Result |
| --- | --- |
| Registered PowerShell action or flow matches in dev mode | TypeAgent executes it and handles the prompt |
| No direct PowerShell match, request is suitable | Bounded reasoning may reuse, create, or repair a flow |
| Request is not suitable for PowerShell | TypeAgent returns not handled and Copilot continues |
| Approved macro contains only replayable MCP steps | TypeAgent preflights and replays it |
| Macro contains an agent-required step | TypeAgent returns a runner launch payload |
| Macro version is draft or disabled | Execution is rejected |
| A tool schema changed after approval | Replay fails before step one with `schemaDrift` |

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

1. Run `@typeagent macro record`.
2. Complete one successful Copilot turn that uses an MCP tool.
3. Run `@typeagent macro status` and copy the returned trace ID.
4. Use `create_macro_from_trace`.
5. Inspect requirements and call `validate_macro`.
6. Ask the user to approve the draft, then call `approve_macro`.
7. Call `run_macro` with the approved macro ID, required inputs, and
   `preference: "auto"`.
8. Use `get_macro_run` to inspect persisted, sanitized replay evidence.

Keep the draft-rejection step in tests and demos. It makes the approval
boundary observable.

## Safety and trust boundaries

Static PowerShell actions contain reviewed scripts. Dynamic flows contain
generated, imported, edited, or repaired scripts. These paths do not currently
have the same trust level.

Dynamic scripts run in PowerShell `FullLanguage` mode. Cmdlet lists, path
validation, module lists, and network flags restrict common command paths, but
they do not prevent direct .NET filesystem, process, network, reflection, or
assembly APIs. Treat dynamic flow execution as host code execution, not as a
security sandbox. See the active FullLanguage issue in codeDocs for the
mitigation plan.

Macro recording is explicit, drafts cannot run, and deterministic replay
preflights every step. Agent-guided execution uses Copilot's permission
surface and remains model-mediated.

Macro boundaries can be disabled independently:

| Environment variable | Boundary |
| --- | --- |
| `TYPEAGENT_MACRO_RECORDING_ENABLED` | Explicit trace recording |
| `TYPEAGENT_MACRO_INDUCTION_ENABLED` | Draft creation |
| `TYPEAGENT_MACRO_REPLAY_ENABLED` | Deterministic replay |
| `TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED` | Agent-runner handoff |

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
  handoffs/<runId>.json
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
- Native Copilot tools require agent-guided execution.
- Macro catalog mutation coordination is process-local.
- Credentialed live end-to-end coverage is not yet a release gate.
- The macro catalog does not enumerate other TypeAgent workflow providers.

## Verification

| Behavior | Focused evidence |
| --- | --- |
| Dev hook options, platform policy, fallthrough, and cancellation | `packages/copilot-plugin/test/hookDevActions.spec.ts` |
| Schema-family routing and dispositions | `packages/dispatcher/test/devActionRouting.spec.ts` |
| Flow transaction, repair, persistence, and namespaces | `packages/agents/powershell/test/actionHandler.spec.ts` |
| Flow storage | `packages/agents/powershell/test/powerShellStore.spec.ts` |
| Macro induction and validation | `packages/copilot-macros/test/macroDefinition.spec.ts` |
| Replay preflight and ordered execution | `packages/copilot-macros/test/deterministicReplay.spec.ts` |
| Versioning, approval, schema drift, and runs | `packages/copilot-macros/test/macroCatalog.spec.ts` |
| Macro MCP surface and packaging | `packages/copilot-plugin/test/macroServer.spec.ts`, `pluginArtifact.spec.ts` |
| Recording RPC integration | `packages/agentServer/server/test/macroRecordingRpc.spec.ts` |

## Key files

| Area | Path |
| --- | --- |
| Dev-action hook | `packages/copilot-plugin/src/hooks/hook-dev-actions.ts` |
| Hook routing and recording commands | `packages/copilot-plugin/src/hooks/hook-router.ts` |
| Macro MCP adapter | `packages/copilot-plugin/src/mcp/macroServer.ts` |
| Macro contracts | `packages/copilot-macros/src/contracts.ts` |
| Induction and validation | `packages/copilot-macros/src/macroDefinition.ts` |
| Macro lifecycle and persistence | `packages/copilot-macros/src/macroManager.ts` |
| Deterministic replay | `packages/copilot-macros/src/deterministicReplay.ts` |
| MCP replay host | `packages/defaultAgentProvider/src/mcp/mcpReplayHost.ts` |
| PowerShell action and flow lifecycle | `packages/agents/powershell/src/actionHandler.mts` |
| PowerShell store | `packages/agents/powershell/src/store/powerShellStore.mts` |
| PowerShell script host | `packages/agents/powershell/scripts/scriptHost.ps1` |
| Capability reasoning profiles | `packages/dispatcher/dispatcher/src/reasoning/reasoningProfile.ts` |

