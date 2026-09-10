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

- `replayable`: TypeAgent can inspect and call the named MCP tool.
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
generalized program from one example. Calls with an MCP server name are
classified as replayable. Calls without one are classified as agent-required.

## Validation and approval

Validate a draft before asking the user to approve it. Validation checks macro
structure, expressions, step ordering, trace provenance, and execution
classes.

When a replay host is configured, approval inspects every replayable tool and
records its schema fingerprint. Approval then writes the next version with
state `approved`. Disabling an approved macro also writes a new version.
Agent-guided adaptations are saved as separate drafts.

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

After a successful agent-guided run, `submitMacroCandidate()` can save an
adapted procedure. It verifies handoff identity, source version, execution
outcome, and budget use before writing a new draft. It never changes or
approves the source macro.

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
