# TypeAgent Studio — Phase 5: Implementation Plan

> **Status:** Drafted 2026-05-14, after [04-mvp-slice.md](./04-mvp-slice.md).
> Revised 2026-06-11 to make this a **single plan for both presenters** — the
> VS Code extension UI and the `studio` agent — over one headless core.
>
> **Purpose:** Concrete shapes — API surfaces, file layouts, schema-versioning rules, transport choices — to make the MVP slice buildable. Where a decision is open, this doc names it as an _open decision_ with a recommended default rather than hand-waving.
>
> **Scope — one capability, two presenters.** Per
> [DESIGN.md §3.0](./DESIGN.md) ("headless core, thin presenters, three
> audiences"), every capability is a typed primitive in `typeagent-core`,
> surfaced by **both** the extension UI **and** the `studio` agent (MCP +
> conversational). The agent is therefore **not a separate plan**: its action
> surface is catalogued in [STUDIO-AGENT.md](./STUDIO-AGENT.md), and its build
> phases (S0–S5) are sequenced inside §11 of this plan. Interaction modes
> (human / AI-agent / hybrid) are described in [USER-STORY.md](./USER-STORY.md).
>
> **Convention:** Type definitions are TypeScript-shaped pseudo-code. They are illustrative; the real types ship in `typeagent-core` and are the single source of truth.

---

## 1. Workspace layout

New + refactored packages, with their location in the TypeAgent monorepo:

```
ts/
  packages/
    typeagent-core/              [NEW]
      src/
        sandbox/                 # F0.1
        corpus/                  # F0.2
        events/                  # F0.3
        feedback/                # F0.4
        health/                  # F0.5
        collisions/              # F0.6
        replay/                  # F4.1
        onboardingBridge/        # F1.1 backend
        runtime/                 # S0: context-agnostic Studio runtime
                                 #     (hosted by the studio agent; the
                                 #      extension consumes it only as a
                                 #      transitional bootstrap — see §3.5/§11)
        index.ts
      package.json
      tsconfig.json

    typeagent-studio/            [NEW — bespoke VS Code extension; UI client of the agent-server]
      src/
        extension.ts             # activation
        sandbox/                 # tree + status bar
        corpora/                 # tree view
        wizard/                  # J1 webview
        schemaStudio/            # J2 webview
        impactReport/            # J4 webview
        traceViewer/             # J5 + J6 shared renderer
        liveTrace/               # J6 panel host
        commands/                # palette wiring
        webviewKit/              # shared webview infra
      media/                     # webview assets
      package.json
      tsconfig.json

    agents/studio/               [NEW — hosts the Studio runtime; AI/MCP surface]
      # depends on typeagent-core/runtime
      # constructs the ONE Studio runtime; the extension/canvas/CLI are clients
      # dispatchable + MCP action surface catalogued in STUDIO-AGENT.md (A–F)
      # exposes a typed result/event channel for rich clients (à la code↔coda)

    agr-language/                [REFACTORED]
      # depends on typeagent-core
      # adds: miss-cluster view, code lenses, schema cross-link

    vscode-shell/                [REFACTORED]
      # depends on typeagent-core
      # adds: capture-to-corpus action, Studio sandbox awareness

    agents/onboarding/           [EXTENDED]
      # adds: snapshot/restore actions
```

**Why `typeagent-core` is a TypeScript package (not an extension):** it has no VS Code dependency. Extensions consume it. CLI tools (post-MVP F4.7) and tests consume it directly. This keeps it portable and testable in isolation.

---

## 2. Event stream API (F0.3) — the foundation

### 2.1 Type surface

```ts
// typeagent-core/src/events/types.ts

export type StudioEvent =
  | PhaseStartEvent
  | PhaseEndEvent
  | CacheHitEvent
  | CacheMissEvent
  | GrammarMatchAttemptEvent
  | GrammarMatchResultEvent
  | ActionSelectedEvent
  | ActionExecutedEvent
  | FeedbackRecordedEvent
  | CollisionDetectedEvent
  | ReasoningStepEvent
  | SandboxLifecycleEvent
  | ReplayRowEvent
  | ReplaySummaryEvent;

export interface StudioEventBase {
  schemaVersion: 1; // bumped on breaking payload changes
  type: string;
  ts: number; // epoch ms
  requestId?: string; // correlates a dispatch
  runId?: string; // correlates a replay
  sandboxId: string; // which sandbox emitted it
  agent?: string;
}

export interface CacheHitEvent extends StudioEventBase {
  type: "cache.hit";
  cacheKey: string;
  systemKind: "completionBased" | "nfa";
}
// ... and so on, one interface per type.
```

**Schema versioning rule:** the top-level `schemaVersion` is bumped only on **payload-breaking** changes. Adding a new optional field or a new event type does _not_ bump it. Removing or renaming a field does. Studio refuses to start if `events.versions()` returns a major it doesn't understand.

### 2.2 Subscription surface

```ts
export interface EventSubscription {
  unsubscribe(): void;
}
export interface EventStream {
  subscribe(
    filter: EventFilter,
    sink: (e: StudioEvent) => void,
  ): EventSubscription;
  query(opts: {
    since?: number;
    until?: number;
    filter?: EventFilter;
  }): AsyncIterable<StudioEvent>;
  versions(): { schemaVersion: number; supportedEventTypes: string[] };
}

export interface EventFilter {
  types?: string[];
  requestIds?: string[];
  runIds?: string[];
  agents?: string[];
  sandboxIds?: string[];
}
```

### 2.3 Transport

- **In-process** (Studio and sandbox in the same Node process via in-memory mode): direct method calls on `EventStream`.
- **Cross-process** (Studio extension host ↔ sandbox subprocess): JSON-RPC over a Unix domain socket on macOS/Linux, named pipe on Windows. WS as fallback only if pipe support is unreliable.
- **Why not Cosmos/Mongo direct read?** dblogging-default-on already sends events there for telemetry; the live stream is for _correlation by requestId_ and needs sub-second p95 — direct pipe/socket beats cloud round-trip.

### 2.4 Emission sites (MVP set)

The minimum sites in dispatcher / cache / grammar / actions / reasoning that emit structured events. Existing `debug("typeagent:*")` calls remain.

| Site                            | Event(s) emitted                                              |
| ------------------------------- | ------------------------------------------------------------- |
| `dispatcher` phase boundaries   | `phase.start`, `phase.end`                                    |
| `cache.constructionMatch`       | `cache.hit`, `cache.miss`                                     |
| `actionGrammar.matchGrammar`    | `grammar.match.attempt`, `grammar.match.result`               |
| `dispatcher` action selection   | `action.selected`                                             |
| Agent `executeAction` wrap      | `action.executed`                                             |
| PR #2341 feedback path          | `feedback.recorded`                                           |
| §10 detectors (all four points) | `collision.detected`                                          |
| `reasoning/tracing/` step emits | `reasoning.step`                                              |
| F0.1 sandbox manager            | `sandbox.start/stop/restart`, `sandbox.agent.loaded/unloaded` |
| F4.1 replay engine              | `replay.row`, `replay.summary`                                |

### 2.5 Open decisions

- **Buffer size.** Recommend a ring buffer of last 10k events in-memory per sandbox; older queryable via Cosmos/Mongo when remote read is enabled.
- **Backpressure.** Sink slow → drop with a single `events.dropped(count)` notification rather than blocking emitters.

---

## 3. Sandbox lifecycle (F0.1)

### 3.1 Type surface

```ts
// typeagent-core/src/sandbox/types.ts

export type SandboxMode = "subprocess" | "inmemory";

export interface SandboxConfig {
  id: string; // stable per workspace
  mode: SandboxMode; // "inmemory" recommended for MVP demo
  profileDir: string; // ~/.typeagent/profiles/<studio-id>/
  agents: string[]; // initial set; can change at runtime
  env?: Record<string, string>; // model keys etc.
  telemetryOptOut?: boolean; // F0.4 sandbox-scoped opt-out
}

export interface SandboxManager {
  start(cfg: SandboxConfig): Promise<SandboxHandle>;
  restart(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  loadAgent(id: string, agentPath: string): Promise<void>;
  unloadAgent(id: string, agentName: string): Promise<void>;
  status(id: string): Promise<SandboxStatus>;
  list(): Promise<SandboxStatus[]>;
}

export interface SandboxStatus {
  id: string;
  mode: SandboxMode;
  state: "starting" | "running" | "stopping" | "stopped" | "crashed";
  agents: {
    name: string;
    schemaHash: string;
    grammarHash: string;
    health: HealthStatus;
  }[];
  startedAt?: number;
  pid?: number; // subprocess mode only
}
```

### 3.2 Process model

- **inmemory mode:** Studio extension host imports the dispatcher directly. Fast, no IPC. Risk: a sandbox crash kills the extension host. Acceptable for the MVP demo path.
- **subprocess mode:** spawn a child Node process running an agent-server. IPC via the same socket/pipe used for F0.3 events. RPC method set is the union of F0.1 and the agent-server's existing RPC API.

### 3.3 Profile isolation

Studio sandbox always uses `~/.typeagent/profiles/<studio-instance>/` — a _different_ profile from the dev's everyday TypeAgent. Captures, displayLog, constructions, collisions all land in this profile dir. **No path under the dev's primary profile is ever read or written.**

### 3.4 Open decisions

- **Crash recovery in inmemory mode.** Recommend isolating sandbox state in a dedicated AsyncContext / VM context so an agent throw doesn't poison the extension host. Subprocess mode is the safe option; inmemory is the fast option.
- **Hot-reload on schema/grammar file save.** Recommend opt-in toggle in Sandbox tree, default off — the dev should control when a re-evaluation happens.

---

## 4. Corpus federation service (F0.2)

### 4.1 Type surface

```ts
// typeagent-core/src/corpus/types.ts

export type CorpusSource = "in-repo" | "captures" | "external" | "feedback";

export interface CorpusEntry {
  id: string; // stable hash of (utterance, requestId?)
  utterance: string;
  agent: string;
  source: CorpusSource;
  provenance: {
    sourceUri: string; // file path or remote URI
    capturedAt?: number;
    sessionId?: string;
    requestId?: string;
  };
  expectedAction?: unknown; // typed action JSON when known
  feedback?: FeedbackLabel; // attached if a userFeedback event matches requestId
  tags?: string[];
}

export interface FeedbackLabel {
  rating: "up" | "down";
  category?: "wrong-agent" | "didnt-understand" | "bad-response" | "other";
  comment?: string;
  recordedAt: number;
}

export interface CorpusService {
  list(agent: string): Promise<CorpusEntry[]>;
  load(agent: string, filter?: CorpusFilter): AsyncIterable<CorpusEntry>;
  append(agent: string, entries: CorpusEntry[]): Promise<void>; // writes to captures/
  promote(agent: string, ids: string[], target: "in-repo"): Promise<void>;
  exportJsonl(
    agent: string,
    filter?: CorpusFilter,
    out: WriteStream,
  ): Promise<void>;
  addExternalSource(spec: ExternalSourceSpec): Promise<void>;
}
```

### 4.2 On-disk layout

```
<repo>/
  corpus/
    player.utterances.jsonl       # in-repo, checked in
    code.utterances.jsonl

  .typeagent/
    studio.json                   # external source declarations

~/.typeagent/profiles/<studio>/
  captures/
    player/
      2026-05-14T10-22.jsonl
      ...
```

### 4.3 JSONL line format

Reuses PR #2341's `@feedback export` schema **verbatim** for feedback entries, extends with the fields above. Each line is one `CorpusEntry`. Comments / metadata lines are not permitted — keep parsing trivial.

### 4.4 Promotion flow (capture → in-repo)

Promotion is an **explicit, two-step user action**:

1. Select entries in Corpora tree → "Promote to in-repo corpus."
2. Studio writes to `corpus/<agent>.utterances.jsonl` and surfaces the change in source control; the dev reviews the diff before committing.

Never auto-promotes. Captures stay personal until the dev says otherwise.

### 4.5 Open decisions

- **De-duplication policy.** Recommend `id = hash(utterance + agent + requestId|"")`; two captures of the same utterance with different requestIds are distinct entries. The Schema Studio UI groups them visually.
- **Remote feedback fetch cadence.** Recommend on-demand pull (button) for MVP, not background polling.

---

## 5. Feedback wrappers (F0.4)

Thin layer over the existing PR #2341 dispatcher RPCs (`recordUserFeedback`, `recordUserHide`, `restoreAllHidden`, `flushHidden`) and `@feedback` commands. Reshapes them into:

```ts
export interface FeedbackService {
  record(
    label: FeedbackLabel & { requestId: string; includeContext?: boolean },
  ): Promise<void>;
  hide(requestId: string): Promise<void>;
  restoreAllHidden(sessionId: string): Promise<void>;
  list(filter: FeedbackFilter): Promise<FeedbackRow[]>;
  top(opts: {
    agent?: string;
    category?: string;
    limit: number;
  }): Promise<FeedbackRow[]>;
  exportJsonl(filter: FeedbackFilter, out: WriteStream): Promise<void>;
  count(filter: FeedbackFilter): Promise<number>;
}
```

Backed by the same Logger sinks (Cosmos / Mongo) — Studio adds nothing to the storage layer.

---

## 6. Health rule engine (F0.5)

### 6.1 Type surface

```ts
// typeagent-core/src/health/types.ts

export type HealthSeverity = "info" | "warning" | "error";

export interface HealthRule {
  id: string; // stable, e.g. "schema.parses"
  description: string;
  check(ctx: HealthContext): Promise<HealthFinding[]>;
}

export interface HealthFinding {
  ruleId: string;
  severity: HealthSeverity;
  agent: string;
  evidence: {
    file?: string;
    range?: [number, number]; // line offsets
    message: string;
  };
  fixHint?: { kind: "code-action" | "command"; payload: unknown };
}

export interface HealthService {
  check(agent: string): Promise<HealthFinding[]>;
  rules(): HealthRule[];
}
```

### 6.2 MVP rule set

| ID                                 | Severity | What it checks                                               |
| ---------------------------------- | -------- | ------------------------------------------------------------ |
| `manifest.parses`                  | error    | `<name>Manifest.json` exists, is valid JSON.                 |
| `manifest.name.matches`            | error    | manifest `name` equals package directory name.               |
| `manifest.schemaPath.exists`       | error    | referenced schema file exists.                               |
| `schema.parses`                    | error    | schema file parses via `actionSchema`.                       |
| `schema.actions.haveGrammar`       | warning  | every action type has at least one AGR rule targeting it.    |
| `grammar.parses`                   | error    | `.agr` file compiles.                                        |
| `grammar.rules.targetKnownActions` | error    | every rule's target action exists in the schema.             |
| `handler.exports.instantiate`      | error    | handler file exports `instantiate(): AppAgent`.              |
| `actions.unique.acrossLoaded`      | warning  | no duplicate action-type names across loaded sandbox agents. |
| `cache.compatible`                 | info     | construction cache schema-hash matches current schema.       |

Rules are written so each one explains its own evidence and fix hint. The wizard's Testing phase runs the full set; live edits in P-4 run just the relevant rule(s).

---

## 7. Collision wiring (F0.6)

```ts
// typeagent-core/src/collisions/types.ts

export type CollisionKind = "overlap" | "shadow" | "ambiguity";
export type CollisionDetectionPoint =
  | "load"
  | "schema-edit"
  | "grammar-edit"
  | "replay";

export interface CollisionEvent extends StudioEventBase {
  type: "collision.detected";
  kind: CollisionKind;
  detectionPoint: CollisionDetectionPoint;
  experimentId?: string; // §10 tagging
  participants: {
    agent: string;
    actionType: string;
    file: string;
    range: [number, number];
  }[];
  exemplarUtterances?: string[];
  resolutionHints?: ResolutionHint[];
}
```

Studio subscribes to `collision.detected` and maps participants → diagnostics, with `resolutionHints` becoming quick-fixes.

---

## 8. Onboarding bridge (F1.1 backend)

```ts
// typeagent-core/src/onboardingBridge/types.ts

export type OnboardingPhaseName =
  | "Discovery"
  | "PhraseGen"
  | "SchemaGen"
  | "GrammarGen"
  | "Scaffolder"
  | "Testing"
  | "Packaging";

export interface OnboardingState {
  sessionId: string;
  agentName: string;
  phases: Partial<Record<OnboardingPhaseName, PhaseSnapshot>>;
  currentPhase: OnboardingPhaseName;
}

export interface PhaseSnapshot {
  status: "pending" | "running" | "complete" | "stale";
  inputs: unknown;
  outputs?: unknown;
  startedAt?: number;
  completedAt?: number;
  ancestorPhaseHashes: string[]; // for stale detection
}

export interface OnboardingBridge {
  start(seed: { description: string }): Promise<OnboardingState>;
  runPhase(
    sessionId: string,
    phase: OnboardingPhaseName,
    inputs?: unknown,
  ): Promise<PhaseSnapshot>;
  snapshot(sessionId: string): Promise<OnboardingState>;
  restorePhase(
    sessionId: string,
    phase: OnboardingPhaseName,
  ): Promise<{
    state: OnboardingState;
    affectedDownstream: OnboardingPhaseName[];
    reconciliationRequired: boolean;
  }>;
  installToSandbox(sessionId: string, sandboxId: string): Promise<void>;
}
```

**Stale detection:** each downstream phase records hashes of upstream phase outputs at the time it ran. If a downstream phase's recorded ancestor hashes don't match current upstream outputs, status flips to `stale` and F1.5 reconciliation prompts fire.

---

## 9. `replayCorpus()` engine (F4.1) — the long pole

### 9.1 Type surface

```ts
// typeagent-core/src/replay/types.ts

export type VersionSpec =
  | { kind: "git"; ref: string }
  | { kind: "workingTree" };

export interface ReplayOptions {
  agent: string;
  corpus: CorpusFilter;
  versionA: VersionSpec;
  versionB: VersionSpec;
  missPolicy: "needs-explanation" | "live-llm" | "strict-cache";
  batchSize?: number; // default 16
}

export interface ReplayRunHandle {
  runId: string;
  rows: AsyncIterable<ActionDelta>;
  summary: Promise<ReplaySummary>;
  cancel(): Promise<void>;
}

export interface ActionDelta {
  utterance: string;
  source: CorpusSource;
  utteranceId: string;

  actionA?: unknown;
  actionB?: unknown;
  equal: boolean;

  cacheStateA:
    | "hit"
    | "miss"
    | "needs-explanation"
    | "llm-resolved"
    | "skipped";
  cacheStateB:
    | "hit"
    | "miss"
    | "needs-explanation"
    | "llm-resolved"
    | "skipped";

  feedbackA?: FeedbackLabel;
  feedbackB?: FeedbackLabel;

  collisionsA: CollisionEvent[];
  collisionsB: CollisionEvent[];

  latencyA: number; // ms
  latencyB: number;
  requestIdA: string;
  requestIdB: string;
}

export interface ReplaySummary {
  runId: string;
  agent: string;
  versionA: VersionSpec;
  versionB: VersionSpec;
  corpusSize: number;
  rowCount: number;
  equalCount: number;
  changedCount: number;
  newMatchCount: number;
  lostMatchCount: number;
  collisionDelta: number;
  duration: number;
  missPolicy: ReplayOptions["missPolicy"];
}
```

### 9.2 Execution model

Two **transient sandboxes** (always inmemory mode for replay, regardless of the active sandbox's mode):

- Sandbox-A loaded with the agent built from `versionA`.
- Sandbox-B loaded with the agent built from `versionB`.

For each utterance, evaluate in both sandboxes; build the `ActionDelta`; emit `replay.row`. At end emit `replay.summary`. Both sandboxes are torn down.

**Why transient + inmemory:** the replay engine controls the lifecycle deterministically; no contamination of the active sandbox; faster.

**Building an agent from a git ref:** `git worktree add` into a temp dir; run the build steps (`tsc -b`, `asc`, `agc`) scoped to that agent; load the built dist into the transient sandbox. The cost is one-time per `versionA` / `versionB` per run.

### 9.3 Miss-policy semantics

| Policy                                         | Behavior                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needs-explanation` _(default, deterministic)_ | A cache miss → `cacheState = needs-explanation`. No action JSON produced for that side. `ActionDelta.equal = false` if one side has action JSON and the other doesn't.  |
| `live-llm`                                     | A cache miss → run the actual LLM translation in that sandbox. Records `cacheState = llm-resolved`. Slow; costs tokens. Cost estimate shown in launch dialog.           |
| `strict-cache`                                 | A cache miss → `cacheState = skipped`. Row is omitted from the report entirely (with a count in the summary). Useful for "what does the cache say today" sanity checks. |

Gate C of MVP is evaluated with `needs-explanation`. The other policies exist but don't bear MVP weight.

### 9.4 Performance budget

≤ 60s for player corpus (target size ~ 200 entries) on a dev laptop. Achieved by: (a) inmemory sandboxes share the V8 heap → no IPC, (b) batched dispatch within each sandbox, (c) no LLM in the default policy. If we slip, the next optimization is **schema-hash-keyed cache sharing** between sandboxes A and B for utterances whose cache key is unchanged across versions.

### 9.5 Open decisions

- **Concurrency.** Recommend a small batch (8–16) with backpressure. Don't go heroic; the LLM-free path is fast enough.
- **Determinism guarantees.** The `needs-explanation` policy is fully deterministic. `live-llm` is not (temperature, model nondeterminism). The launch dialog warns explicitly.

---

## 10. Presentation layer — one runtime, many clients

The Studio runtime is built on `typeagent-core` and instantiated **once, inside
the `studio` agent** in the agent-server (DESIGN §3.5). Every surface is a
**client** of that runtime, not a second host: the `typeagent-studio` extension
(rich human UI), the `vscode-shell` canvas (generic chat), an AI orchestrator
(MCP), and the CLI. This is the `code` : `coda` shape — the agent owns the
capability + a channel; the extension is the rich client/view.

### 10.1 UI client — webview infrastructure

Five webviews. All share a common module:

```
typeagent-studio/src/webviewKit/
  host.ts              # extension-side host (create, restore, post messages)
  protocol.ts          # message types between host and webview
  client/              # bundle that runs inside the webview iframe
    rpc.ts             # promise-based RPC over postMessage
    theme.ts           # VS Code theming hooks
    components/        # shared widgets (table virtualization, JSON tree, diff)
```

Each webview:

- Uses a single `Webview` instance per concept; multiple instances disallowed (open-the-existing-one behavior).
- Persists state across reloads via `webview.setState`.
- Communicates with the host via the `webviewKit/protocol.ts` message types; the host turns those messages into `studio`-agent action calls over the agent-server (not into an in-process runtime).

**No direct dispatcher state in the webview or the extension host.** Always:
webview → extension host → agent-server (`studio` agent) → runtime → sandbox. The
extension renders typed results and subscribes to the agent's event stream; it
does not own the runtime. (The current in-process `createStudioRuntime` is a
transitional bootstrap — see §11.)

### 10.2 Agent — host of the runtime; the AI / conversational surface

The `studio` agent (`packages/agents/studio/`) **hosts the runtime** and exposes
the Studio loop as **typed, dispatchable actions** — automatically available over
MCP and conversationally, with no new transport code. It follows the `onboarding`
agent template (manifest + per-group schema/handler) and constructs the
**S0 headless runtime** (`@typeagent/core/runtime`) rather than a VS Code context.

The surface is **layered by abstraction** (full catalogue in
[STUDIO-AGENT.md](./STUDIO-AGENT.md)):

- **Tier 1 — Primitives:** 1:1 with a core function; the typed result is the data.
- **Tier 2 — Composites:** a few primitives sequenced into a useful unit.
- **Tier 3 — Goal-oriented:** an LLM-planned loop with structured progress and approval checkpoints.

Action groups (each maps to a build phase in §11):

| Group          | Mutates? | Examples                                                                                               |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| A. Inspect     | no       | `ListAgents`, `DescribeAgent`, `GetSchema`, `ListCollisions`, `GetCoverage`, `QueryEvents`, `GetTrace` |
| B. Author/edit | yes      | `AddAction`, `AddGrammarRule`, `GenerateGrammarFromSchema`, `BuildAgent` (always `dryRun`-able)        |
| C. Corpus      | yes      | `SeedInRepoCorpus`, `CaptureSession`, `PromoteCaptures`                                                |
| D. Run/try     | sandbox  | `StartSandbox`, `LoadAgent`, `RunUtterance(s)`                                                         |
| E. Validate    | no       | `ScanCollisions`, `HealthGate`, `ReplayCorpus`, `DetectRegressions`, `ValidateChange`                  |
| F. Orchestrate | composes | `ImproveCoverage`, `FixRegression`, `TuneAgent`, `ReviewAgent`                                         |

**Approval boundary (hybrid mode).** Autonomous-safe (no approval): all of group
A; `RunUtterance(s)` (group D) **when it runs in a throwaway sandbox**; and the
read-only group E analyses — `ScanCollisions`, `HealthGate`, `DiffGrammars`,
`CoverageDelta`, `CollisionsDelta`, and `ReplayCorpus` / `ValidateChange` under
the deterministic `needs-explanation` policy. Require `dryRun` + approval (or an
explicit allow-list policy): all of groups B and C (and anything that commits);
sandbox lifecycle that persists state (`StartSandbox` / `LoadAgent` against a
non-throwaway sandbox); and any **cost-bearing or external-calling** run —
notably `ReplayCorpus(live-llm)` and large-corpus replays, which show a cost
estimate first. Tier-3 orchestration (group F) runs the whole loop but pauses at
each group-B/C mutation for the same checkpoint. This mirrors onboarding's
`pending → in-progress → approved` model and the same confirmations the UI uses.
Authentic 👍/👎 feedback stays human; the agent may only _propose_ labels.

**MCP exposure uses the existing TypeAgent integration** — there is no new
Studio MCP host in scope (locked decision Q8). The `studio` agent's actions
become available over MCP and `list_commands` automatically by virtue of being a
registered TypeAgent agent, the same way the `onboarding` agent's are.

**The agent owns the runtime; clients reach it through the dispatcher.** The
agent's handler calls its hosted runtime directly (agent action → runtime →
sandbox). The `typeagent-studio` webview host reaches that **same** runtime by
calling the `studio` agent's actions over the agent-server — it does not hold a
runtime of its own.

---

## 11. Phasing — concrete sequencing

Re-stated from §6 of MVP slice, with the engine work mapped to packages/files.

**One capability, one runtime, many clients — by P-6.** Each capability is a
headless primitive in `typeagent-core`, assembled into the Studio runtime that is
hosted **once, in the `studio` agent** (DESIGN §3.5). Every surface is a client
of that runtime: the `studio` agent's own dispatchable actions (groups A–F per
§10.2), the `typeagent-studio` UI, the `vscode-shell` canvas, an AI orchestrator
(MCP), and the CLI. The invariant is that **no capability is permanently UI-only
or agent-only** — every one is reachable as a typed action by MVP. It does **not**
mean every surface lands the same week: **read-only** actions (the Inspect slice
S1) ride along in P-1; the **mutating / sandbox-executing** actions (Run, Corpus,
Validate, Author) land in P-3/P-4 behind the approval checkpoint. The agent's own
phases **S0–S5** map onto the phases below (see the table at the end). There is
one plan; the agent is not a separate track.

### P-0 Skeleton (week 0–1)

- Create `typeagent-core` package, `typeagent-studio` extension, scaffold files. No behavior.
- Refactor `agr-language` and `vscode-shell` to import from `typeagent-core` (no consumed APIs yet — just the dependency edge). Full existing test suites must remain green.
- **Agent (S0 — headless runtime):** extract the engine wiring out of the extension's `studioRuntimeCore` into a context-agnostic runtime in `typeagent-core/runtime/` (done). Scaffold `packages/agents/studio/` (manifest, schema, handler), which **hosts** that runtime; ship the first read-only Inspect actions (done). The extension keeps its in-process runtime as a **transitional bootstrap**.
- **Migration (Option B):** define the `studio` agent's **typed result / event channel** (the `code↔coda` analogue) and begin moving the `typeagent-studio` extension from its in-process runtime to an agent-server client of the `studio` agent. Tracked as a cross-cutting migration that completes as each UI surface's backing actions land (S1→S4); the extension must not gain _new_ in-process runtime logic.
- Exit: `pnpm -r build` clean; refactored extensions behave identically to today; the `studio` agent loads and answers the read-only Inspect actions over the dispatcher / MCP.

### P-1 Foundations (weeks 1–4)

- **F0.3 events.** Define types in `events/types.ts`. Wire emission sites in dispatcher / cache / grammar / actions / reasoning. Build the in-process transport and a stub subprocess transport. Unit test event filtering and schema versioning.
- **F0.1 sandbox.** Implement inmemory mode end-to-end first, subprocess mode second. Sandbox tree + status bar UI.
- **F0.2 corpus.** Implement service against the on-disk layout. Corpora tree UI. Capture-to-corpus action on vscode-shell bubbles (F4.6 starts here, on purpose, per risk mitigation).
- **F0.4 feedback.** Thin wrappers + filter chip components.
- **F0.5 health.** Ten MVP rules + UI in Sandbox tree.
- **F0.6 collisions.** Wire detectors → events → diagnostics.
- **F0.7 conversational, F0.8 miss-policy, F0.9 workflow view, F0.10 reasoning view.** Land at end of P-1; they are mostly small.
- **Agent (S1 — Inspect, group A):** `ListAgents`, `DescribeAgent`, `GetSchema`/`GetGrammar`, `ListActions`, `GetCoverage`, `SearchCorpus`, `ListCollisions`, `QueryEvents` — each wraps the same primitive the P-1 UI surfaces. Read-only; proves MCP/conversational drivability with zero mutation risk. Register `studio` in `defaultAgentProvider` (the dispatcher load path, not Studio's discovery).
- Exit: Gate A is reachable (the parts that don't need the wizard); corpus capture is producing labelled data; the Inspect surface is callable over MCP / conversationally.

### P-2 J1 vertical (weeks 4–6)

- F1.1 wizard webview + onboarding snapshot/restore backend.
- F1.2 conversational entry routing.
- F1.3 install-into-sandbox.
- F1.4 health gate on phase 7.
- F1.5 reconciliation prompts.
- **Agent:** `ScaffoldAgent` delegates to the `onboarding` agent (no duplication of J1); `studio` picks the loop up at install.
- Exit: **Gate A passes** with a stranger walking the script.

### P-3 J4 vertical (weeks 4–9, runs partly in parallel with P-2)

- F4.6 player corpus capture path already running from P-1. Build labelled set to target size during P-3.
- F4.1 `replayCorpus()`. Implement `needs-explanation` policy first; `strict-cache` second; `live-llm` last.
- F4.2 launch dialog.
- F4.3 Impact Report: panes 1, 2, 4 first; pane 3 (action-level) last because it's the novel surface.
- F4.4 predicate, configurable.
- F4.5 export.
- In parallel: **J5 trace viewer module (F5.1, F5.2, F5.3, F5.4)** so J4 drill-in is real at demo time.
- **Agent (S2 — Run/try + Corpus, groups D, C):** `StartSandbox`/`LoadAgent`/`RunUtterance(s)`; corpus `SeedInRepoCorpus`/`AddExternalCorpus`/`CaptureSession`/`PromoteCaptures` (writes behind `dryRun` + approval).
- **Agent (S3 — Validate, group E):** `ScanCollisions`, `HealthGate`, `DiffGrammars`, `CoverageDelta`, `CollisionsDelta`; then `ReplayCorpus` / `DetectRegressions` / `ValidateChange` as `replayCorpus()` lands — emitting the same `ActionDelta[]` contract the Impact Report webview renders. `ValidateChange` is the read-only composite that returns one Impact-Report-shaped verdict. Autonomous-safe only for the deterministic `needs-explanation` policy; `live-llm` / large-corpus runs require approval (see §10.2).
- **Agent (Trace, group A):** `GetTrace(requestId)` ships here with the J5 trace viewer (it needs the structured dispatch tree), so an agent can drill into a replay/regression row exactly like the Trace Viewer does.
- Exit: **Gate C passes** ≥ 80% on hand-labelled regression set. **Gate D passes.** `ValidateChange` returns an Impact-Report-shaped verdict headlessly.

### P-4 J2 + J3 verticals (weeks 6–9)

- F2.1 Schema Studio webview.
- F2.2 schema code lenses.
- F2.3 suggest-variant code action.
- F2.4 inline collision diagnostics (already enabled by F0.6).
- F2.5 feedback chips.
- F2.6 live re-evaluation.
- F3.\* AGR refactor + new features.
- **Agent (S4 — Author/edit, group B):** `ProposeActionsFromUtterances`, `AddAction`/`EditAction`, `ProposeGrammarVariations`, `AddGrammarRule`/`EditGrammarRule`, `GenerateGrammarFromSchema`, `BuildAgent`/`CompileGrammar` — mutating, always `dryRun`-able, behind the approval checkpoint shared with the Schema Studio UI.
- Exit: **Gate B passes.**

### P-5 J6 vertical (week 9)

- F6.1 Live Trace panel (reuses Trace Viewer renderer in tail mode).
- F6.2 status-bar item.
- **Agent:** `QueryEvents` / an event-tail action (group A) over the same structured event stream the Live Trace panel tails (`GetTrace` already shipped in P-3).
- Exit: **Gate E passes.**

### P-6 Validation & hardening (week 9–10)

- Run all five gates on a clean laptop.
- Performance budgets.
- dblogging-default-on privacy indicator polish.
- **Agent (S5 — Orchestrate, group F):** `ImproveCoverage`, `FixRegression`, `TuneAgent`, `ReviewAgent` — Tier-3 goal-oriented loops that compose the S1–S4 actions and pause at each mutation checkpoint. (`ValidateChange` is the read-only verdict composite from P-3, which these loops call.) Lands here because it can only compose primitives that already exist.
- **Agent-mode gate:** a scripted MCP/conversational run of the Inspect→Run→Validate loop (mode B) and a hybrid `dryRun` + approval run (mode C), so agent-drivability is validated like the human gates.
- Documentation: this plan series + a Studio README + a Demo runbook.

(Weeks are relative; this is sequencing, not a calendar commitment.)

#### Agent phase ↔ plan phase

| Agent phase         | Action group   | Lands in |
| ------------------- | -------------- | -------- |
| S0 headless runtime | —              | P-0      |
| S1 Inspect          | A              | P-1      |
| S2 Run/try + Corpus | D, C           | P-3      |
| S3 Validate         | E              | P-3      |
| S4 Author/edit      | B              | P-4      |
| (Trace)             | A (`GetTrace`) | P-3      |
| S5 Orchestrate      | F              | P-6      |

---

## 12. Test strategy

### Unit

- `typeagent-core` modules tested in isolation via Jest (`*.spec.ts`). No VS Code dependency.
- The replay engine has the most coverage: deterministic policy gives stable golden ActionDeltas; tests use synthetic versions A/B.

### Integration

- `*.test.ts` live integration in `typeagent-core` — exercise the full sandbox lifecycle, real cache, real grammar, against a small embedded corpus.
- Replay integration test: a fixture branch with a known schema change; assert specific rows appear as "red" or "green."

### Extension

- `typeagent-studio` uses the standard `@vscode/test-electron` harness for activation + command palette tests.
- One end-to-end test per gate (A–E) using a scripted scenario — long runtime, run in a separate CI job.

### Agent (`studio`)

- Action handlers are thin over `typeagent-core/runtime`, so most logic is already covered by core unit/integration tests; handler tests assert routing + the typed result shape + `dryRun` behavior for mutations.
- Agent-mode gate (P-6): a scripted MCP/conversational run of the Inspect → Run → Validate loop (mode B) and a hybrid `dryRun` + approval run (mode C).

### Validation gate (Gate C) test

- A versioned hand-labelled regression set checked into the repo: `corpus/player.regressions.jsonl`. Each entry tags `{branch, prior-action, current-action, human-verdict}`. The CI test computes agreement against the predicate and fails below 80%.

---

## 13. Open decisions tracker (top of mind)

Each decision is named, with the recommended default and the deadline phase by which it must be locked.

| #   | Decision                                            | Default                                                   | Lock by                                       |
| --- | --------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- | --- |
| D1  | Subprocess transport: socket vs pipe vs WS          | Unix socket / Windows named pipe; WS fallback             | P-1                                           |
| D2  | Event buffer size and backpressure behavior         | 10k ring, drop with `events.dropped(n)`                   | P-1                                           |
| D3  | Corpus entry de-duplication policy                  | `hash(utterance + agent + requestId                       | "")`                                          | P-1 |
| D4  | Remote feedback fetch cadence                       | On-demand pull                                            | P-1                                           |
| D5  | Onboarding stale-phase semantics on partial restore | Mark stale + reconciliation prompt; no auto-merge         | P-2                                           |
| D6  | `replayCorpus()` concurrency                        | Batch 8–16; backpressure on event sink                    | P-3                                           |
| D7  | `likely-bad change` default predicate exact form    | `(feedbackA.up ∧ actionA ≠ actionB) ∨ feedbackB.down`     | P-3                                           |
| D8  | Webview message protocol stability                  | Versioned alongside event schema; bump on breaking change | P-1                                           |
| D9  | Privacy indicator placement when dblogging on       | Status-bar dot + Sandbox tree row; opt-out toggle         | P-1                                           |
| D10 | Gate C threshold                                    | 80%                                                       | P-3 (re-evaluated against measured agreement) |

---

## 14. Validation (for this implementation plan doc)

Before kicking off P-0, confirm:

- [ ] §1 workspace layout matches the parallel-plan TypeAgent Studio brand.
- [ ] §2 event schema-versioning rule is right (bump only on payload-breaking changes).
- [ ] §3 sandbox profile isolation is acceptable (Studio always writes under its own profile dir; never touches the dev's primary profile).
- [ ] §4 corpus promotion is strictly explicit (no auto-promotion of captures into repo).
- [ ] §6 health rule set covers the right invariants; nothing critical missing.
- [ ] §9 `replayCorpus()` execution model (transient inmemory sandboxes, two of them per run) is acceptable.
- [ ] §11 phasing puts F4.6 corpus capture in P-1 (not P-3) per the risk-register mitigation.
- [ ] §10 + §11 deliver each capability through **both** presenters (UI + `studio` agent) over one core primitive, and the S0–S5 ↔ P-phase mapping is right.
- [ ] §13 open decisions are the right ones to track; their defaults are sane.

---

_End of Phase 5 implementation plan draft._
