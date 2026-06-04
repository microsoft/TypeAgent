# Copilot SDK task family (decision 0010)

Status: **Adopted (v1).** Design-complete for the full family; v1 ships
only `copilot.invoke` (the rest is documented and approved but
deferred to a later rev). The IR schema does **not** change — every
member of the family is just a registered task.

Related:

- [../../principles/design-principles.md](../../principles/design-principles.md) — P1-P5 and the "fewest concepts / behavioral variance" discipline.
- [0001-bound-outputs.md](0001-bound-outputs.md) — `bind`/`$from` mechanism the deferred fork pattern relies on.
- [0003-task-schema-source.md](0003-task-schema-source.md) — Option 1' drift check: the rule that rejects non-object IR `outputSchema`s for `copilot.invoke`.
- [0011-task-context-schema-awareness.md](0011-task-context-schema-awareness.md) — engine extension that exposes a node's declared schemas to the task implementer (used by `copilot.invoke` to drive its schema-guided turn loop).

## 1. Problem

The workflow engine ships an `llm.generate` builtin task that calls a
chat model via the in-repo `aiclient` package. We want sibling tasks
that drive **agentic** turns through the GitHub Copilot CLI via
[`@github/copilot-sdk`](https://github.com/github/copilot-sdk).

The SDK is qualitatively different from `aiclient`:

- **Stateful.** A long-lived `CopilotClient` (which spawns a CLI
  subprocess over JSON-RPC) hosts one or more `CopilotSession`s.
- **Agentic.** The model calls tools (read/write file, shell, web,
  MCP servers, custom JS handlers) inside the session's tool-use
  loop.
- **Permissioned.** Every tool call is gated through an
  `onPermissionRequest` callback the host must supply.
- **Sub-agent capable.** Custom agents declared at session creation
  (`customAgents: [{name, prompt, tools, ...}]`) are auto-delegated
  to by the runtime.
- **State-rich.** `sessions.fork`, `session.history.compact`, and
  `session.history.truncate` (all marked `@experimental` on the SDK's
  RPC surface) provide non-destructive forks from a given event ID,
  forced compaction, and destructive rollback respectively.
- **Event-streaming.** `assistant.message_delta`, `tool.execution_*`,
  `subagent.*`, `session.idle`, `session.compaction_*`, and more.

Mapping all of this naively into the IR would create several new
IR-level concepts (sessions as IR-visible resources, sub-agent
topology as IR structure, tool surfaces as wired data flow). The IR
discipline (§principles preamble: "fewest concepts / behavioral
variance"; "principles govern the boundary, not the interior") says
we should NOT pull those into the IR unless they earn it.

## 2. Key insight: the family fits with zero new IR concepts

The Copilot SDK's session/fork/compact APIs operate on two opaque
identifiers: **session ID** (string) and **event ID** (string).
These are pure data. They flow through the IR's existing reference
mechanism — `bind` (decision 0001) and `$from: "scope"` —
without requiring any new IR concept:

```
research:    copilot.session.send  →  bind: "research" = { sessionId, lastEventId, text }
                          ┌─────────────────────────────────────────┐
                          ▼                                         ▼
forkA:  copilot.session.fork                      forkB:  copilot.session.fork
        { sessionId: $from research.sessionId,            { sessionId: $from research.sessionId,
          toEventId: $from research.lastEventId }           toEventId: $from research.lastEventId }
        bind: "branchA" = { sessionId }                    bind: "branchB" = { sessionId }
              │                                                  │
              ▼                                                  ▼
sumA:   copilot.session.send (parallel)            sumB:   copilot.session.send (parallel)
```

Principle scorecard:

- **P2** ("All data flow is traceable through the IR alone" — _for any
  task input, can I trace it back to its origin by reading the IR?_):
  every consumer reads who forked from what.
- **P3** ("IR structure corresponds to computational structure" — _does
  the IR reveal the pattern, or must you analyze the graph to discover
  it?_): a fork in the conversation is a fork in the IR.
- **P5** ("A reader of the IR can predict engine behavior" — _would a
  reader be surprised by the behavior?_): which nodes share session
  state is visible from the IR.
- **Fewest concepts.** Zero new IR concepts. Sessions and event IDs are
  opaque values; the existing reference machinery moves them. Each
  task is just typed-in, typed-out (P4 boundary).

## 3. The full task family

Each entry has a one-line "earns its place by exposing a distinct SDK
behavior the existing tasks cannot reproduce" justification.

| Task                      | Earns its place by                                                                               | Implementation phase |
| ------------------------- | ------------------------------------------------------------------------------------------------ | -------------------- |
| `copilot.invoke`          | Convenience: create+send+close in one call; no session-ID plumbing; matches `llm.generate` shape | **v1 (now)**         |
| `copilot.session.create`  | Produce a session ID; configure model/agents/tools once                                          | Deferred             |
| `copilot.session.send`    | Send a turn; return `{sessionId, lastEventId, text}` so downstream can fork or rewind            | Deferred             |
| `copilot.session.fork`    | Non-destructive branch from a remembered event ID — the parallel-continuation primitive          | Deferred             |
| `copilot.session.compact` | Force compaction; expose `tokensRemoved` / `contextWindow` for IR-visible decisions              | Deferred             |
| `copilot.session.close`   | Release in-memory resources (data preserved on disk for resume)                                  | Deferred             |

`copilot.session.truncate` (destructive in-place rollback) is
**rejected** from the family — see §6 alternative D.

## 4. Schema-guided design (applies to every member of the family that

returns a value)

`copilot.invoke` (and the deferred `copilot.session.send`) is "JSON in,
JSON out": the registered output schema is `{ "type": "object" }`, and
the _actual_ per-call output shape is whatever the IR node declares as
its `outputSchema`. Decision 0003 (Option 1') already makes the IR
node's `outputSchema` authoritative; this decision adds the rule that
the task **uses** that schema to drive the agent's response, not just
have it validated post-hoc.

The pattern is TypeChat-shaped:

1. **The task reads `ctx.outputSchema`** — exposed by decision 0011
   (engine API extension; not an IR change).
2. **It registers a synthetic `submit_response` tool** whose
   parameters JSON Schema _is_ the node's `outputSchema`. The system
   prompt nudges the agent to call it exactly once when finished.
3. **It runs the agent** via `session.sendAndWait`.
4. **It captures the validated tool arguments** from the
   `submit_response` handler. The SDK validates the tool args against
   the schema before our handler runs, so most of the repair work is
   free.
5. **On failure** — either the agent called `submit_response` with
   schema-invalid arguments (the SDK's tool-validation message
   becomes the next-turn instruction), or the session reached `idle`
   without `submit_response` being called (the task sends a follow-up
   nudge) — **it retries** within a bounded budget.

Default repair budget: **3 attempts** (initial + 2 repairs). Override
via optional `repairBudget?: integer` input; budget ≥ 1; task-internal
cap at 10 to prevent runaway loops. On budget exhaustion,
`copilot.invoke` returns
`{ kind: "fail", error: { message, data: { lastResponse, ajvErrors, attempts } } }`
so the workflow's existing `onError` mechanism can react.

Non-object IR `outputSchema`s are **rejected at IR validation time**
by decision 0003's drift check (Option 1') — `copilot.invoke`'s
registered output is `{"type":"object"}`, and any narrower IR-side
declaration must be a subtype of that. Free-text returns require
explicit wrapping (e.g.
`{type:"object", required:["text"], properties:{text:{type:"string"}}}`).
Primitive returns are not supported in v1; if a real workflow needs
them, the answer is a separate task (e.g. `copilot.invokeText`), not
blurring this one.

The IR author's optional `systemMessage` input is **appended** to the
SDK's system prompt scaffolding (mode `append`), never replaces it.

## 5. v1 task: `copilot.invoke`

### 5.1 Input schema

| Field             | Type                                                         | Required | Notes                                                             |
| ----------------- | ------------------------------------------------------------ | -------- | ----------------------------------------------------------------- | -------- | --- | -------------------------- |
| `prompt`          | string                                                       | yes      | The user-turn message                                             |
| `model`           | string                                                       | no       | e.g. `"gpt-5"`. Defaults to engine config / SDK default           |
| `systemMessage`   | string                                                       | no       | Appended to SDK system prompt scaffolding (mode `append`)         |
| `customAgents`    | array of `{name, displayName?, description, prompt, tools?}` | no       | Pure-data sub-agent definitions                                   |
| `allowedTools`    | string[]                                                     | no       | Allow-list of CLI built-in tool names (`view`, `edit`, `bash`, …). The engine always merges the synthetic `submit_response` tool into the SDK's `availableTools` allow-list so an empty `allowedTools: []` (deny all built-ins) still leaves the termination contract intact. |
| `attachments`     | array of `{path}`                                            | no       | Paths validated against the `validateFilePath` allowed roots      |
| `timeoutMs`       | integer                                                      | no       | Hard cap on session run time                                      |
| `reasoningEffort` | `"low"                                                       | "medium" | "high"                                                            | "xhigh"` | no  | For models that support it |
| `repairBudget`    | integer                                                      | no       | Schema-repair attempts; default 3, range 1–10                     |

### 5.2 Output schema (registered)

`{ "type": "object" }`. Per-call shape comes from the IR node's
declared `outputSchema` per §4.

### 5.3 Side-effects and permissions

`sideEffects: true`. The engine's existing per-task policy
(`allow|prompt|deny`) gates the entire invocation as today. **Inside**
the session, the SDK's `onPermissionRequest` is wired to `approveAll`
in v1 — the agent may freely call any tool the SDK exposes
(read/write file, shell, web, MCP, custom). This is deliberately
temporary; see §7.

### 5.4 Authentication

Environment variables only — `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` /
`GITHUB_TOKEN` — falling back to the `copilot` CLI's stored OAuth
login. No `gitHubToken` or `provider` field appears in the IR. Same
posture as `llm.generate`. Per-task BYOK is purely additive and can
be added later without revisiting this record.

## 6. Deferred tasks (design captured; not in v1 implementation)

All `sideEffects: true`. All schema-guided per §4 (where applicable).

- **`copilot.session.create`**
  - In: same as `copilot.invoke` minus `prompt`/`repairBudget`.
  - Out: `{ sessionId: string }`.
- **`copilot.session.send`**
  - In: `{ sessionId, prompt, attachments?, timeoutMs?, repairBudget? }`.
  - Out: `{ sessionId, lastEventId, ...<schema> }` where `<schema>`
    is whatever the IR node declares; `sessionId` and `lastEventId`
    are added by the task on top of the IR-declared object so
    downstream nodes can `bind` and chain. (The IR author declares
    these fields on their node's `outputSchema`.)
- **`copilot.session.fork`**
  - In: `{ sessionId, toEventId? }`.
  - Out: `{ sessionId }` (the new fork's ID).
- **`copilot.session.compact`**
  - In: `{ sessionId }`.
  - Out: `{ sessionId, tokensRemoved, messagesRemoved, contextTokens, contextLimit }`.
- **`copilot.session.close`**
  - In: `{ sessionId, deletePersistent?: boolean }`.
  - Out: `{}`. (`deletePersistent: true` calls the SDK's
    `deleteSession` instead of `disconnect`.)

## 7. Permission posture and the longer-term direction

v1's `approveAll` posture is **deliberately temporary**. The durable
answer is a **capability-based security model** in which: (a) each
task declares the capabilities it needs (file-write, shell, network,
outbound-domain), (b) a workflow declares the capability budget it
grants, and (c) the engine enforces the intersection at task
boundaries. This aligns with the existing aspiration in
[../../principles/design-principles.md](../../principles/design-principles.md):

> "The design should remain open to expanding what tasks declare
> about themselves … capability and side-effect declarations."

That work is engine/IR-wide, not Copilot-specific, so it gets its own
decision record when it begins. The Copilot family will be one of its
first consumers — its `onPermissionRequest` is the natural enforcement
point.

## 8. Engine-side concerns (not IR concepts)

### 8.1 SDK client lifecycle

The `@github/copilot-sdk` `CopilotClient` spawns a CLI subprocess and
holds a JSON-RPC connection. Spawning per task call is too expensive.
v1 holds a **lazy module-singleton** in
`engine/src/copilotClientHost.ts`, lazily started on first call to any
`copilot.*` task and disposed at engine shutdown. The SDK import
itself is dynamic (`import("@github/copilot-sdk")`) so consumers who
never invoke any `copilot.*` task don't pay the bundled-CLI install
cost on first use.

### 8.2 Session-leak safety net

`copilot.invoke` creates an internal session per call and disposes it
in a `finally`. The deferred `copilot.session.*` family creates
session IDs that cross node boundaries; without a safety net, long
workflows leak. Recommended approach for the deferred tasks (already
plumbed into `copilotClientHost.ts` for v1 so it's ready):

- **Explicit close is the contract.** Authors `bind` a session ID
  and pair it with a `copilot.session.close` consumer.
- **Best-effort safety net.** The host module maintains a per-run
  set of Copilot session IDs created by `copilot.session.create` /
  `copilot.session.fork`, and disconnects any not closed when the
  run ends (success or failure).

This is **not** a new IR concept — it's an engine concern analogous
to `AbortSignal` cleanup.

### 8.3 Concurrency

The SDK explicitly states "no built-in session locking; concurrent
access to the same session is undefined." When fork lands, the engine
MUST ensure two `copilot.session.send` nodes never share the same
session ID. Forking creates a new ID, so the IR-correct pattern (fork
before parallel send) makes this fall out automatically. A future
validation warning could flag two sends in concurrent regions
referencing the same `sessionId`.

### 8.4 Experimental SDK surface

`sessions.fork`, `session.history.compact`, and
`session.history.truncate` are marked `@experimental` on the SDK's
RPC layer. **`copilot.invoke` does NOT use any experimental RPCs** —
it only uses stable `createSession` / `sendAndWait` / `disconnect`
plus the stable `defineTool` mechanism for `submit_response`. When the
deferred `copilot.session.*` family lands, the experimental calls
will be isolated in `copilotClientHost.ts` so the surface area is one
well-named adapter.

## 9. Alternatives considered

### A. Single-shot only, opaque session per call (no session.\* family)

Reject. Forecloses the fork/rewind/parallel-continuation patterns the
SDK specifically supports, with no IR-side justification. Leaves
genuine capability on the floor.

### B. IR-visible "resource handle" type for sessions

Reject. Session IDs are already opaque strings; introducing a new IR
concept (handle/resource value with engine-managed lifetime) earns no
behavioral variance the existing reference mechanism cannot already
express. Cleanup is an engine concern (§8.2), not an IR concern. The
"fewest concepts" discipline rejects new concepts that only relabel
existing mechanisms.

### C. Non-IR-visible "session context" carried in `TaskContext`

Reject. Violates P2 (data flow happens outside the IR — readers
can't see which nodes share a session) and P5 (reader can't predict
which sessions are shared without consulting engine internals). The
fact that session IDs cross node boundaries via `bind`/`$from` is
exactly what makes the family principle-aligned.

### D. Include `copilot.session.truncate` in the family

Reject. Destructive in-place mutation of a session referenced by other
nodes violates P5 ("would a reader be surprised by the behavior,
including by what the engine keeps alive?"). `fork` covers the same
use cases non-destructively; truncate's only edge over fork is "saves
the cost of duplicating the session prefix," which is not a workflow
author concern.

### E. Free-text output (fixed `{text}` shape) for `copilot.invoke`

Reject. Schema-guided structured output is the headline value of
running a tool-using agent inside a workflow — downstream nodes can
reference structured fields via `$from … path: […]` with full P1
type-checking. `llm.generate` already exists for free-text use; that
is the right destination for callers who want a string.

### F. Schema-guidance via system-prompt-only or wrapping primitives

Reject system-prompt-only: brittle parsing of the agent's last message
(must strip code fences, narrative text), no SDK-side validation,
hits the repair loop more often. Reject primitive wrapping: creates
two ways to express one thing in the IR (`{type:"string"}` vs
`{type:"object", properties:{value:{type:"string"}}}`) which would
behave differently — P5 violation. The chosen design uses the SDK's
typed-tool surface (`defineTool`) as a clean termination contract.

## 10. Risks and gotchas

- **Bundled CLI install size.** `@github/copilot-sdk` bundles the
  Copilot CLI binary. Mitigated by dynamic import in
  `copilotClientHost.ts`.
- **CI cannot make real Copilot calls.** Tests mock the client
  factory. Per repo policy, `pnpm run test:live` is not run.
- **Experimental RPCs in deferred tasks.** When the
  `copilot.session.*` family lands, the experimental surface is
  isolated in `copilotClientHost.ts` so a future SDK churn affects
  one adapter.

## 11. Cross-references

- [../../principles/design-principles.md](../../principles/design-principles.md) — P1-P5 and the "fewest concepts" discipline.
- [0001-bound-outputs.md](0001-bound-outputs.md) — `bind`/`$from` mechanism the deferred fork pattern relies on.
- [0003-task-schema-source.md](0003-task-schema-source.md) — Option 1' drift check that rejects non-object IR `outputSchema`s for `copilot.invoke`.
- [0011-task-context-schema-awareness.md](0011-task-context-schema-awareness.md) — engine extension exposing the node's declared schemas to the task implementer; what makes §4 possible.
- [../ir-v1.md](../ir-v1.md) §3.5 (task node), §5.2 (runtime output schema validation).
