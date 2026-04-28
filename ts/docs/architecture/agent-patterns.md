# Agent Patterns — Architecture & Design

> **Scope:** This document describes the nine architectural patterns used by
> TypeAgent application agents. Use it when designing a new agent or choosing
> a scaffolding template. For the dispatcher that hosts agents, see
> `dispatcher.md`. For how to automate agent creation, see the onboarding
> agent at `packages/agents/onboarding/`.

## Overview

Every TypeAgent agent exports an `instantiate(): AppAgent` function and
implements the `AppAgent` interface from `@typeagent/agent-sdk`. Beyond that
common contract, agents fall into nine patterns based on how they communicate
with external systems, whether they manage persistent state, and what kind of
output they produce.

| Pattern                  | When to use                              | Examples                        |
| ------------------------ | ---------------------------------------- | ------------------------------- |
| `schema-grammar`         | Bounded set of typed actions (default)   | `weather`, `photo`, `list`      |
| `external-api`           | Authenticated REST / cloud API           | `calendar`, `email`, `player`   |
| `llm-streaming`          | Agent calls an LLM, streams results      | `chat`, `greeting`              |
| `sub-agent-orchestrator` | API surface too large for one schema     | `desktop`, `code`, `browser`    |
| `websocket-bridge`       | Automate a host app via a plugin         | `browser`, `code`               |
| `state-machine`          | Multi-phase workflow with approval gates | `onboarding`, `powershell`      |
| `native-platform`        | OS / device APIs, no cloud               | `androidMobile`, `playerLocal`  |
| `view-ui`                | Rich interactive web-view UI             | `turtle`, `montage`, `markdown` |
| `command-handler`        | Simple settings-style direct dispatch    | `settings`, `test`              |

---

## Pattern details

### 1. `schema-grammar` — Standard (default)

The canonical TypeAgent pattern. Define TypeScript action types, generate a
`.agr` grammar file for natural language matching, and implement a typed
dispatch handler.

**File layout**

```
src/
  <name>Manifest.json      ← agent metadata, schema pointers
  <name>Schema.ts          ← exported union of action types
  <name>Schema.agr         ← grammar rules (NL → action)
  <name>ActionHandler.ts   ← instantiate(); executeAction() dispatch
```

**AppAgent lifecycle**

```typescript
export function instantiate(): AppAgent {
  return { initializeAgentContext, executeAction };
}
```

**When to choose:** any integration with a well-defined, enumerable set of
actions — REST APIs, CLI tools, file operations, data queries.

**Examples:** `weather`, `photo`, `list`, `image`, `video`

---

### 2. `external-api` — REST / OAuth Bridge

Extends the standard pattern with an API client class and token persistence.
The handler creates a client on `initializeAgentContext` and authenticates
lazily or eagerly on `updateAgentContext`.

**Additional files**

```
src/
  <name>Bridge.ts          ← API client class with auth + HTTP methods
~/.typeagent/profiles/<profile>/<name>/token.json  ← persisted OAuth token
```

**Manifest flags:** none beyond standard.

**When to choose:** cloud services requiring OAuth or API-key auth — MS Graph,
Spotify, GitHub, Slack, etc.

**Examples:** `calendar` (MS Graph), `email` (MS Graph + Google), `player`
(Spotify)

---

### 3. `llm-streaming` — LLM-Injected / Streaming

Runs inside the dispatcher process rather than as a sandboxed plugin
(`injected: true`). The handler calls an LLM directly and streams partial
results back to the client via `streamingActionContext`.

**Manifest flags**

```json
{
  "injected": true,
  "cached": false,
  "streamingActions": ["generateResponse"]
}
```

**Dependencies added:** `aiclient`, `typechat`

**When to choose:** conversational or generative agents that need to produce
streaming text — chat assistants, summarizers, code generators.

**Examples:** `chat`, `greeting`

---

### 4. `sub-agent-orchestrator` — Multiple Sub-Schemas

A root agent with a `subActionManifests` map in its manifest. Each sub-schema
has its own TypeScript types, grammar file, and handler module. The root
`executeAction` routes to the appropriate module based on action name (each
sub-schema owns a disjoint set of names).

**File layout**

```
src/
  <name>Manifest.json          ← includes subActionManifests map
  <name>Schema.ts              ← root union type (optional)
  <name>ActionHandler.ts       ← routes to sub-handlers
  actions/
    <group>ActionsSchema.ts    ← per-group action types
    <group>ActionsSchema.agr   ← per-group grammar
```

**Manifest structure**

```json
{
  "subActionManifests": {
    "groupOne": { "schema": { ... } },
    "groupTwo": { "schema": { ... } }
  }
}
```

**When to choose:** integrations whose API surface spans distinct domains that
would make a single schema unwieldy — editor + debugger + terminal, or
read/write/admin operations.

**Examples:** `desktop` (7 sub-agents), `code` (6), `browser` (4), `onboarding` (7)

---

### 5. `websocket-bridge` — Host Plugin via WebSocket

The TypeAgent handler owns a `WebSocketServer`. A host-side plugin (VS Code
extension, browser extension, Electron renderer, Office add-in) connects as
the WebSocket client. Commands flow TypeAgent → WebSocket → plugin; results
flow back. Requires a companion plugin project.

**File layout**

```
src/
  <name>ActionHandler.ts    ← starts WebSocketServer, forwards actions
  <name>Bridge.ts           ← WebSocket server + pending-request map
plugin/ (or extension/)
  <host-specific files>     ← connects to the bridge and calls host APIs
```

**AppAgent lifecycle:** implements `closeAgentContext()` to stop the server.

**Dependencies added:** `ws`

**When to choose:** automating an application that runs its own JS/TS runtime
(VS Code, Electron, browser, Office).

**Examples:** `browser`, `code`

---

### 6. `state-machine` — Multi-Phase Workflow

Persists phase state to `~/.typeagent/<name>/<workflowId>/state.json`. Each
phase progresses `pending → in-progress → approved` and must be approved
before the next phase begins. Designed for long-running automation that spans
multiple sessions.

**State structure**

```typescript
type WorkflowState = {
  workflowId: string;
  currentPhase: string;
  phases: Record<string, { status: PhaseStatus; updatedAt: string }>;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

**When to choose:** build pipelines, onboarding flows, multi-step test
suites — any workflow where a human must review and approve each stage before
proceeding.

**Examples:** `onboarding`, `powershell`, `taskflow`

---

### 7. `native-platform` — OS / Device Automation

Invokes platform APIs directly via `child_process.exec` / `spawn`, device
SDKs, or signal handling. No cloud dependency.

**Key considerations**

- Branch on `process.platform` (`"win32"` / `"darwin"` / `"linux"`) for
  cross-platform commands.
- Use `SIGSTOP` / `SIGCONT` for pause/resume on Unix where applicable.
- Keep side effects narrow — prefer reversible commands.

**When to choose:** controlling a desktop application, mobile device, or
system service that exposes no REST API.

**Examples:** `androidMobile`, `playerLocal` (macOS `afplay` / Linux `mpv`),
`desktop`

---

### 8. `view-ui` — Web View Renderer

A minimal action handler that opens a local HTTP server serving a `site/`
directory and signals the dispatcher to open the view via `openLocalView`.
The actual UX lives in the `site/` directory; the handler communicates with
it via display APIs and IPC types.

**File layout**

```
src/
  <name>ActionHandler.ts    ← opens/closes view, handles actions
  ipcTypes.ts               ← shared message types for handler ↔ view IPC
site/
  index.html                ← web view entry point
  ...
```

**Manifest flags:** `"localView": true`

**When to choose:** agents that need a rich interactive UI beyond simple text
or markdown output.

**Examples:** `turtle`, `montage`, `markdown`

---

### 9. `command-handler` — Direct Dispatch

Uses a `handlers` map keyed by action name instead of the typed `executeAction`
pipeline. Actions map directly to named handler functions. The pattern is
suited for agents with a small number of well-known, settings-style commands
where the full schema + grammar machinery adds more overhead than value.

```typescript
export function instantiate(): AppAgent {
  return getCommandInterface(handlers);
}

const handlers = {
  setSetting: async (params) => {
    /* ... */
  },
  getSetting: async (params) => {
    /* ... */
  },
};
```

**When to choose:** configuration agents, toggle-style controls, admin tools.

**Examples:** `settings`, `test`

---

## Choosing a pattern

```
Does the agent need to stream text from an LLM?
  └─ Yes → llm-streaming

Does the agent automate an app with its own JS/TS runtime?
  └─ Yes → websocket-bridge

Does the agent span a multi-step, human-gated workflow?
  └─ Yes → state-machine

Is the API surface too large for one schema?
  └─ Yes → sub-agent-orchestrator

Does the agent need a rich interactive UI?
  └─ Yes → view-ui

Does the agent call an authenticated cloud API?
  └─ Yes → external-api

Does the agent invoke OS/device APIs directly?
  └─ Yes → native-platform

Does the agent have only a handful of well-known commands?
  └─ Yes → command-handler

Otherwise → schema-grammar (default)
```

## Scaffolding

The onboarding agent's scaffolder can generate boilerplate for any pattern:

```
scaffold the <name> agent using the <pattern> pattern
```

Or use `list agent patterns` at runtime for the full table. See
`packages/agents/onboarding/` for details.
