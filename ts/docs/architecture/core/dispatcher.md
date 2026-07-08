# Dispatcher — Architecture & Design

> **Scope:** This document describes the dispatcher package — the core
> routing engine that processes user input, translates natural language
> into typed actions, manages agent lifecycles, and orchestrates action
> execution. For the grammar language and matching algorithms, see
> `actionGrammar.md`. For the completion pipeline, see `completion.md`.

## Overview

The dispatcher is TypeAgent's central orchestration layer. It accepts
user input (natural language or structured `@`-commands), resolves it to
one or more typed actions, and dispatches those actions to the
appropriate application agents. The dispatcher is split across four npm
packages:

| Package                       | Role                                                  |
| ----------------------------- | ----------------------------------------------------- |
| `agent-dispatcher`            | Core implementation — translation, execution, context |
| `@typeagent/dispatcher-types` | Public interface (`Dispatcher`) and shared types      |
| `@typeagent/dispatcher-rpc`   | RPC serialization layer for remote clients            |
| `dispatcher-node-providers`   | Node.js agent loading and file-system storage         |

```
User input
     │
     ▼
┌───────────────────────────────────────────────────────┐
│  Dispatcher                                           │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Command    │  │ Translation  │  │  Execution   │ │
│  │  Resolution  │─→│   Pipeline   │─→│    Engine    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│          ↕                 ↕                 ↕        │
│  ┌──────────────────────────────────────────────────┐ │
│  │     AppAgentManager (agent registry & state)     │ │
│  └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
     │
     ▼
  AppAgent.executeAction() / executeCommand()
```

### Key concepts

| Term                        | Meaning                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Typed action**            | A structured object (`{ actionName, parameters }`) representing a user intent, validated against a schema. |
| **Schema**                  | A TypeScript action type definition that describes the set of actions an agent can handle.                 |
| **`@`-command**             | A structured command prefixed with `@` (e.g., `@config agent player`). No LLM translation needed.          |
| **Translation**             | The process of converting natural language to typed actions — via cache match or LLM call.                 |
| **`CommandHandlerContext`** | The central state object that holds all runtime state for a dispatcher session.                            |
| **`AppAgentManager`**       | The agent registry that manages agent manifests, schemas, state, and lifecycle.                            |
| **Flow**                    | A multi-step recipe (sequence of actions) that an agent can register for compound operations.              |

---

## Package structure

```
packages/dispatcher/
├── dispatcher/                     # Core implementation (agent-dispatcher)
│   └── src/
│       ├── dispatcher.ts           # Factory & Dispatcher object creation
│       ├── index.ts                # Public exports
│       ├── internal.ts             # Internal APIs
│       ├── agentProvider/          # AppAgentProvider interface
│       ├── command/                # Command resolution & execution
│       ├── context/                # Session, agent manager, memory, chat history
│       │   ├── dispatcher/         # Built-in dispatcher agent
│       │   └── system/             # Built-in system agent & handlers
│       ├── execute/                # Action execution orchestrator
│       ├── translation/            # Cache matching & LLM translation
│       ├── reasoning/              # LLM reasoning adapters (Claude, Copilot)
│       ├── search/                 # Internet search integration
│       ├── storageProvider/        # Abstract storage interface
│       ├── helpers/                # Config, console, status utilities
│       └── utils/                  # Cache factories, metrics, exceptions
├── types/                          # Public types (@typeagent/dispatcher-types)
│   └── src/
│       ├── dispatcher.ts           # Dispatcher interface & result types
│       ├── clientIO.ts             # ClientIO display interface
│       └── displayLogEntry.ts      # Display log entry types
├── rpc/                            # RPC layer (@typeagent/dispatcher-rpc)
│   └── src/
│       ├── dispatcherServer.ts     # Server-side RPC handler
│       ├── dispatcherClient.ts     # Client-side RPC proxy
│       ├── clientIOServer.ts       # ClientIO RPC server
│       └── clientIOClient.ts       # ClientIO RPC client
└── nodeProviders/                  # Node.js integration (dispatcher-node-providers)
    └── src/
        ├── agentProvider/
        │   └── npmAgentProvider.ts  # NPM-based agent loading
        └── storageProvider/
            └── fsStorageProvider.ts  # File-system storage provider
```

---

## Core interfaces

### `Dispatcher`

The public API surface — returned by `createDispatcher()` and consumed by
hosts (shell, CLI, web).

```typescript
interface Dispatcher {
  submitCommand(
    command,
    attachments?,
    options?,
    clientRequestId?,
    requestId?,
  ): Promise<SubmitResult>;
  interrupt(
    command,
    attachments?,
    options?,
    clientRequestId?,
    requestId?,
  ): Promise<SubmitResult>;
  getCommandCompletion(prefix, direction): Promise<CommandCompletionResult>;
  checkCache(request): Promise<CommandResult | undefined>;
  getDynamicDisplay(appAgentName, type, displayId): Promise<DynamicDisplay>;
  getStatus(): Promise<DispatcherStatus>;
  getAgentSchemas(agentName?): Promise<AgentSchemaInfo[]>;
  respondToChoice(choiceId, response): Promise<CommandResult | undefined>;
  getDisplayHistory(afterSeq?): Promise<DisplayLogEntry[]>;
  cancelCommand(requestId): void;
  close(): Promise<void>;
}
```

`submitCommand` is the unified entry point for both ack-on-enqueue and
await-completion callers. On success it returns `{ok:true, entry}` where
`entry` is the queued request descriptor (a `SubmittedRequest`) with a
`completion: Promise<CommandResult | undefined>` attached. Hosts that
want to block on the result `await r.entry.completion` after checking
`r.ok`; hosts that just want a queue ack ignore `r.entry.completion`.
The `awaitCommand(dispatcher, …)` utility in
`@typeagent/dispatcher-types` wraps this into a one-liner that returns
`Promise<CommandResult | undefined>` and throws on submit failure for
callers that want the classic shape. See
[`messageQueueing.md`](./messageQueueing.md) §14.1 for the unification
history and the wire/in-process split.

### `CommandHandlerContext`

The central state object that threads through every operation. Created
once per session via `initializeCommandHandlerContext()` and shared
across all requests within that session. Key members:

| Field                  | Type                           | Purpose                                           |
| ---------------------- | ------------------------------ | ------------------------------------------------- |
| `agents`               | `AppAgentManager`              | Agent registry, schema state, lifecycle           |
| `session`              | `Session`                      | Persistent configuration (models, caching, etc.)  |
| `agentCache`           | `AgentCache`                   | Construction and grammar cache for translations   |
| `agentGrammarRegistry` | `AgentGrammarRegistry`         | NFA-based grammar matching engine                 |
| `translatorCache`      | `Map<string, Translator>`      | Per-schema LLM translator instances               |
| `chatHistory`          | `ChatHistory`                  | Conversation memory for context-aware translation |
| `conversationMemory`   | `ConversationMemory`           | Structured RAG for entity resolution              |
| `displayLog`           | `DisplayLog`                   | Persistent output log with sequence numbering     |
| `commandLock`          | `Limiter`                      | Serializes commands (one at a time)               |
| `activeRequests`       | `Map<string, AbortController>` | In-flight request cancellation                    |
| `clientIO`             | `ClientIO`                     | Abstract display interface for the host           |

### `ClientIO`

The abstract display layer that decouples the dispatcher from any
specific UI. Implemented by the shell (Electron), CLI (console), and
web clients. Handles:

- Displaying action results and status messages
- Streaming partial actions during LLM generation
- Presenting choices to the user
- Setting display metadata (emoji, agent name)

---

## Command processing pipeline

Every user interaction enters through `submitCommand()`. The request is
enqueued on the per-conversation `RequestQueue`; when its turn arrives
the drain loop invokes the in-dispatcher `processCommand` pipeline body
(see [`messageQueueing.md`](./messageQueueing.md) §3 for the queue
diagram). The pipeline body acquires the command lock (kept as
defense-in-depth — the queue already serializes), sets up request
tracking, and delegates to the resolution → translation → execution
pipeline.

### 1. Command resolution

```
submitCommand(input) ──► RequestQueue ──► drain loop ──► processCommand pipeline
     │
     ▼
normalizeCommand(input)          # Add "@" prefix if missing
     │
     ▼
resolveCommand(normalizedInput)  # Greedy token matching
     │
     ├─→ "@config agent player"  → system command (config handler)
     ├─→ "@player play ..."      → agent command (player handler)
     └─→ "play Yesterday"        → natural language (translation pipeline)
```

`resolveCommand()` uses **greedy exact-match tokenization** against
a hierarchical `CommandDescriptorTable`. It consumes the first token
as a potential agent name, then walks nested subcommand tables. If a
token doesn't match, it rolls back and defaults to the system agent.

The result classifies the input as either:

- **A structured command** — routed directly to the agent's
  `executeCommand()` handler.
- **A natural language request** — forwarded to the translation
  pipeline for action resolution.

### 2. Translation pipeline

Natural language requests pass through a two-stage pipeline: cache match
first, then LLM translation as fallback.

```
interpretRequest(request)
     │
     ▼
┌──────────────────────────────────────────────┐
│  Can use cache?                               │
│  (no attachments, no special instructions,    │
│   cache enabled in session config)            │
└──────┬───────────────────────────┬────────────┘
       │ yes                       │ no
       ▼                           │
  matchRequest()                   │
  ┌────────────────────┐           │
  │ agentCache.match() │           │
  │ (grammar + constr.)│           │
  └────────┬───────────┘           │
           │                       │
    ┌──────┴──────┐                │
    │ hit         │ miss           │
    ▼             ▼                ▼
  validate   translateRequest()
  wildcards  ┌──────────────────────────────────┐
    │        │ pickInitialSchema()              │
    │        │ → semantic search or last-used   │
    │        │                                  │
    │        │ translateWithTranslator()         │
    │        │ → LLM call (GPT, Claude, etc.)  │
    │        │                                  │
    │        │ finalizeAction()                  │
    │        │ → handle schema switches         │
    │        │ → resolve unknowns               │
    │        └──────────────────────────────────┘
    │                    │
    └────────────────────┘
             │
             ▼
    confirmTranslation()   # User override if needed
             │
             ▼
       InterpretResult { requestAction, fromCache, elapsedMs }
```

#### Cache matching (`matchRequest`)

The cache layer provides the fastest path to action resolution. It checks
two sources in parallel:

1. **Grammar rules** — grammar based matching against compiled `.agr` files.
   Produces exact structural matches with wildcard captures.
2. **Constructions** — Previously cached LLM translations that matched
   similar requests. Stored as templates with wildcard slots.

If a match is found, the dispatcher validates it:

- **Entity wildcards** are checked against conversation memory — can
  the captured value resolve to a known entity?
- **Regular wildcards** are validated by the target agent's
  `validateWildcardMatch()` callback.

Only fully validated matches are accepted. Invalid matches fall through
to LLM translation.

#### LLM translation (`translateRequest`)

When no cache match exists, the dispatcher invokes an LLM to translate
the request:

1. **Schema selection** — `pickInitialSchema()` chooses the most likely
   target schema via embedding-based semantic search or falls back to
   the last-used schema.

2. **Translator creation** — `getTranslatorForSchema()` builds a
   `TypeAgentTranslator` configured with the selected schema's action
   types. If optimization is enabled, `getTranslatorForSelectedActions()`
   narrows the action set using semantic search.

3. **Translation** — The translator calls the LLM with the request,
   conversation history, and attachments. Supports streaming partial
   results (relayed to the host via `streamPartialAction()`).

4. **Finalization** — `finalizeAction()` handles multi-step resolution:
   - If the LLM returns an `"unknown"` action, the dispatcher searches
     for a better agent via `findAssistantForRequest()` (semantic search
     over all registered schemas).
   - If the LLM returns a switch action, the dispatcher re-translates
     with the new schema.
   - For `MultipleAction` results, each sub-request is finalized independently.

#### Activity context

When an activity is active (e.g., the user is in a "music" session),
the translation pipeline prioritizes activity-related schemas:

1. Translate with activity schemas first.
2. If the result contains unknown actions and the activity isn't
   restricted, retry with non-activity schemas.
3. Merge the results — executable actions from the activity translation
   combined with resolutions from the broader schema set.

#### History context

The dispatcher builds a `HistoryContext` from the chat history to
provide conversation-aware translation:

- Recent user/assistant exchanges (for coreference resolution)
- Top-K named entities mentioned in conversation
- User-provided instructions and guidance
- Current activity context

This context is passed to both the cache layer and the LLM translator.

### 3. Action execution

Once actions are resolved, the execution engine takes over:

```
executeActions(actions[], entities?)
     │
     ▼
toPendingActions()         # Entity resolution pass
     │
     ▼
canExecute()?              # Check for unknown/disabled schemas
     │ yes
     ▼
┌── action loop ────────────────────────────────────────┐
│                                                       │
│  Is pending request? ──yes──→ translatePendingRequest │
│         │ no                         │                │
│         ▼                            ▼                │
│  Check for flow? ──yes──→ processFlow()               │
│         │ no                                          │
│         ▼                                             │
│  appAgent.executeAction(action, actionContext)        │
│         │                                             │
│         ▼                                             │
│  Process ActionResult:                                │
│  - Display output to client                           │
│  - Register choices (if any)                          │
│  - Set activity context (if changed)                  │
│  - Extract entities → conversation memory             │
│  - Queue additional actions (if any)                  │
│  - Collect metrics                                    │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Entity resolution** — Before execution, `toPendingActions()` resolves
entity references. Named entities (e.g., "that song", "the meeting") are
looked up in conversation memory. Ambiguous references trigger a user
clarification prompt via the `ClientIO` layer.

Translated actions may also contain **entity placeholders** — explicit
references the LLM emits as string values pointing back at entities
provided in the prompt's history context. `resolveEntityPlaceholders()`
in `pendingActions.ts` replaces them with the referenced values. Grammar:

| Form                          | Example                       | Resolves to                                      |
| ----------------------------- | ----------------------------- | ------------------------------------------------ |
| Bare whole-value              | `${entity-0}`                 | `entity.name`                                    |
| Embedded structured reference | `${entity-0}[Revenue]`        | `<entity.name>[Revenue]` (literal concatenation) |
| Dotted path navigation        | `${entity-0.facets[0].value}` | Result of walking the path on the entity object  |

Path navigation is controlled by the session config
`translation.entity.pathNavigation` with four modes:

| Mode                 | Behavior on a valid path                   | Behavior on miss                                                       |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `"off"`              | Not attempted — placeholder passes through | N/A                                                                    |
| `"throw"` (default)  | Resolves and interpolates                  | Throws `Entity path did not resolve …`, surfaced to the reasoning loop |
| `"fallback-to-name"` | Resolves and interpolates                  | Returns `entity.name` (same as the bare form)                          |
| `"passthrough"`      | Resolves and interpolates                  | Leaves the literal `${entity-N.…}` placeholder intact                  |

The `"throw"` default is intentional: a path miss is almost always an LLM
mistake about the entity's shape (or a shape that changed under it), and
the reasoning loop can retry with a corrected path. Silent fallbacks hide
these mistakes as wrong-answer-looks-right failures downstream.

When path navigation is enabled (any mode ≠ `"off"`), the translator
system prompt includes a short line documenting the dotted syntax so the
LLM knows it's an available form — see `createTypeAgentRequestPrompt()`
in `chatHistoryPrompt.ts`.

**Flow execution** — Some actions have registered flow definitions
(multi-step recipes). When `getFlow(schemaName, actionName)` returns a
flow, the `flowInterpreter` executes it step-by-step with parameter
interpolation, rather than calling the agent's `executeAction()` directly.

**Streaming** — During LLM translation, the dispatcher can relay partial
action objects to agents via `streamPartialAction()`. This allows agents
to begin rendering results before translation is complete (e.g.,
progressively displaying search results).

---

## Agent management

### `AppAgentManager`

The `AppAgentManager` is the central registry for all agents. It handles
registration, lifecycle management, state tracking, and schema caching.

#### Registration flow

```
addProvider(provider)
     │
     ▼
provider.getAppAgentNames()     # Discover available agents
     │
     ▼
┌── for each agent ─────────────────────────────────────┐
│                                                       │
│  provider.getAppAgentManifest(name)                   │
│       │                                               │
│       ▼                                               │
│  addAgentManifest(name, manifest)                     │
│  ┌─────────────────────────────────────────────┐      │
│  │ For each schema in manifest:                │      │
│  │  - Parse action schema (.ts → ActionSchema) │      │
│  │  - Cache schema file on disk                │      │
│  │  - Add to semantic map (embeddings)         │      │
│  │  - Load static grammar (.agr)               │      │
│  │  - Register grammar in AgentGrammarRegistry │      │
│  │  - Load flow definitions                    │      │
│  └─────────────────────────────────────────────┘      │
│                                                       │
│  If manifest.localView = true:                        │
│  - Reserve a port slot (assigned 0 = OS-chosen)       │
│  - Agent's view server spawned on first activation    │
│  - Server binds to OS-assigned port, reports back     │
│    via IPC → stored via SessionContext.setLocalHostPort│
│                                                       │
└───────────────────────────────────────────────────────┘
```

Agents are loaded lazily — the manifest and schemas are registered at
startup, but the agent code itself (`AppAgent` instance) is only loaded
when first needed via `ensureAppAgent()`.

#### Agent lifecycle

```
Registration     Initialization         Active                 Cleanup
───────────────────────────────────────────────────────────────────────
addAgentManifest → ensureSessionContext → executeAction/Command → closeSessionContext
                  │                     │                        │
                  ├─ ensureAppAgent()   ├─ updateAgentContext() ├─ updateAgentContext(false)
                  ├─ initializeAgent()  ├─ getDynamicSchema()   ├─ closeAgentContext()
                  └─ createSession()    └─ getDynamicGrammar()  └─ removeAgent()
```

- **`ensureSessionContext()`** — Lazily initializes an agent: loads the
  `AppAgent` instance from the provider, calls `initializeAgentContext()`,
  creates a `SessionContext`.
- **`updateAction()`** — Enables or disables a specific schema. When
  enabling, loads dynamic schemas and grammars from the agent.
- **`closeSessionContext()`** — Disables all schemas, calls
  `closeAgentContext()`, releases resources.

#### State management

Each schema's state is tracked independently:

| State         | Meaning                                            |
| ------------- | -------------------------------------------------- |
| **Enabled**   | Schema is registered and turned on in config       |
| **Active**    | Enabled AND not transiently disabled               |
| **Loading**   | Schema is in the process of being initialized      |
| **Transient** | Temporarily toggled on/off for the current request |

`setState()` computes state changes against the current configuration
and applies them — enabling schemas triggers `updateAgentContext(true)`,
disabling triggers `updateAgentContext(false)`.

The dispatcher agent and system commands are always enabled and cannot
be disabled.

#### Semantic search

The `AppAgentManager` maintains an `ActionSchemaSemanticMap` — an
embedding index of all registered action schemas. This powers:

- **Schema selection** during LLM translation (`pickInitialSchema`)
- **Unknown action resolution** (`findAssistantForRequest`)
- **Execution validation** (suggesting correct agents when a schema
  is disabled)

Embeddings are cached to disk and loaded at startup.

---

## Action collision detection

> **Soft-rollout plan:** the staged experiment plan
> ([`collision-rollout.md`](../collision/collision-rollout.md)) is the canonical
> record of which detection points / strategies are being tested, how
> testers opt in, what telemetry shape we capture, and the Cosmos query
> reference. Update it as experiments run.
>
> **Analysis tooling:** [`collision-analysis.md`](../collision/collision-analysis.md)
> is the user guide to the data + analysis surface — corpus pipeline,
> action similarity, neighborhood preview, and the three interactive
> HTML visualizations.

When two or more agents can plausibly handle the same input, the
dispatcher needs a policy for picking a winner. Before this subsystem,
the pipeline silently took the first validated match — invisible
collisions, no way to evaluate alternatives. Action collision detection
makes the decision observable and configurable across four detection
points, each with one of four resolution strategies. The whole subsystem
is opt-in: defaults preserve legacy behavior.

See [`packages/dispatcher/dispatcher/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/dispatcher/dispatcher/README.md#action-collision-detection)
for the user-facing config reference. This section documents the design.

### Detection points

| Point              | When                                                                                | Hook                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`static`**       | Agent registration time                                                             | `AppAgentManager.scanActionNameCollisions()` — walks `actionConfigs`, builds `Map<actionName, occurrences[]>`, returns entries with `length > 1`.           |
| **`grammarMatch`** | Cache/grammar match path, after wildcard validation                                 | `getValidatedMatches()` returns all validated matches (legacy `getValidatedMatch` returned only the first); `resolveGrammarCollision()` applies a strategy. |
| **`llmSelect`**    | Embedding-based schema selection in `pickInitialSchema()`                           | When `llmSelect.detect` is on, `semanticSearchActionSchema` is called with `topN ≥ 2`; ambiguity = top-2 score delta < `scoreDeltaThreshold`.               |
| **`fuzzy`**        | Static (post-load) and runtime (post-resolver) — semantic similarity across schemas | `fuzzyCollision.ts` — pluggable `FuzzyScorer` interface; ships `PlaceholderScorer` (returns 0); `ActionEmbeddingScorer` is reserved for a follow-up.        |

### Pipeline integration

```
User input
     │
     ▼
matchRequest()
     │
     ▼
agentCache.match()                 # heuristically-sorted MatchResult[]
     │
     ▼
getValidatedMatches()              # validated subset, original order
     │
     ▼
collision.grammarMatch.detect ?
     │
     ├── no  → return validated[0]                        (legacy path)
     │
     └── yes → isCollision(validated, classifier)
                │
                ├── no  → return validated[0]
                │
                └── yes → resolveGrammarCollision(validated, ctx, request)
                          │
                          ├── { kind: "match", match }    → use as TranslationResult
                          │
                          └── { kind: "clarify", clarify } → wrap in ClarifyMultipleAgentMatches
                                                             ExecutableAction; downstream
                                                             execution renders the prompt.
```

The LLM-select path follows the same shape inside `pickInitialSchema`:
the function's return type is widened to `string | { clarify }`, and the
caller (`translateRequestWithActiveSchemas`) short-circuits to return the
clarify action directly when ambiguity fires.

### Resolution strategies

All runtime detection points share the same four-way strategy enum:

| Strategy       | Implementation                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `first-match`  | `validated[0]`. Byte-identical to legacy `getValidatedMatch`.                                                                                                                                                                 |
| `score-rank`   | Re-sort by `(matchedCount desc, nonOptionalCount desc, -wildcardCharCount)`; ties fall through to `priority`. Today the cache pre-sorts by these heuristics, so this is a no-op except on ties.                               |
| `priority`     | Sort by `getAgentPriority(getAppAgentName(schemaName), ctx)`. Priority comes from `collision.priorityOrder` (comma-separated names) if set, otherwise registration order from `AppAgentManager.getAgentRank()`.               |
| `user-clarify` | Build a `ClarifyMultipleAgentMatches` listing all `(schemaName, actionName, score?)` candidates. The dispatcher agent's clarify handler renders it via `actionIO.appendDisplay`; the user's reply re-enters the request loop. |

The `static` point uses `warn` / `error`. The async `onSchemaReady`
re-scan path (for late-arriving MCP agents) **always** degrades `error`
to `warn` so a slow agent can never crash a live session.

### Clarify schema

A new `ClarifyMultipleAgentMatches` variant lives in
`clarifyActionSchema.ts` alongside the existing intra-schema variants:

```ts
export interface ClarifyMultipleAgentMatches {
  actionName: "clarifyMultipleAgentMatches";
  parameters: {
    request: string;
    candidates: { schemaName: string; actionName: string; score?: number }[];
    clarifyingQuestion: string;
  };
}
```

Cross-agent collisions need both the schema and the action — overloading
the existing `ClarifyMultiplePossibleActionName.possibleActionNames:
string[]` with `"agent.action"` strings would be a covert schema change
that other handlers (LLM clarifying flows) might not understand.

### Telemetry

`CommandHandlerContext.collisionEvents: CollisionEvent[]` is a
50-entry ring buffer; `emitCollisionEvent()` in `collisionTelemetry.ts`
appends events and (independently) writes a `debug("typeagent:dispatcher:collision")`
line. Each event includes `kind`, `request`, `candidates`, `chosen`,
`strategy`, and `elapsedMs`.

This is the **A/B evaluation surface** — the user wants to compare the
four strategies empirically, and without telemetry the choice is opaque.
Ring-buffer-on-context (rather than file-based logging) keeps the
data accessible programmatically for tests and tooling.

### MultipleAction interaction

When a request decomposes into a `MultipleAction` batch, sub-action
collisions need a policy. `collision.multipleActionBehavior` selects one:

| Value                             | Behavior                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `downgrade-to-priority` (default) | Silently fall back to `priority` for any sub-action collision. Telemetry records the original collision so the choice is auditable. |
| `pause-and-prompt`                | **TODO** — requires non-trivial batch-executor pause/resume support. Today auto-degrades to `downgrade-to-priority`.                |
| `abort`                           | Surface the clarify and fail the batch; the user re-issues.                                                                         |

The flag is checked by reading `ctx.executingMultipleAction` (a new
boolean on `CommandHandlerContext` set true while a batch is being processed).

### Vampire test agent

[`packages/agents/vampire`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/vampire) — a
default-disabled agent purpose-built to deliberately collide with player,
list, and calendar via exact-name actions, grammar overlap, and synonym
actions. It exists so the four resolution strategies can be evaluated on
real input rather than synthetic `MatchResult[]` fixtures. See its README
for the action surface and smoke-test sequence.

### Out of scope (and why)

- **`MatchResult.conflictValues`** — that field tracks parameter-value
  conflicts during cache matching, **not** action collisions. A leading
  comment in `matchCollision.ts` notes this so future readers don't
  conflate them.
- **`switch.fixed` short-circuit** — when a user has pinned a schema via
  `translation.switch.fixed`, LLM-select detection is skipped. A pin is
  by definition not ambiguous.

### TODOs

Listed in the dispatcher README under
[Action Collision Detection › TODOs](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/dispatcher/dispatcher/README.md#todos--open-work).
The big ones:

- Real `ActionEmbeddingScorer` implementation (currently placeholder).
- Runtime fuzzy detection hook (config exists; call site not yet wired).
- `pause-and-prompt` behavior for `MultipleAction` (auto-degrades today).
- Fuzzy threshold calibration once a real scorer lands.
- Surface the runtime `collisionEvents` ring buffer through a command
  (`@grammar collisions` covers the static-scan side via NFA product
  construction with concrete witnesses; the runtime side is still
  programmatic-only).

---

## Built-in agents

The dispatcher registers two built-in agents via `inlineAgentProvider`:

### System agent

Handles `@`-prefixed system commands. The full set is registered in
`systemHandlers` ([systemAgent.ts](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/dispatcher/dispatcher/src/context/system/systemAgent.ts)):

| Command                  | Purpose                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@action`                | Direct invocation of a typed action (bypasses NL translation).                                                                                                                                                |
| `@clear`                 | Clear the display.                                                                                                                                                                                            |
| `@config`                | Session configuration — models, caching, agents, schema toggles, collision detection.                                                                                                                         |
| `@const`                 | Construction store management (load/save, list, merge, delete, auto-save toggle).                                                                                                                             |
| `@conversation`          | Manage local dispatcher conversations (named, persisted under `~/.typeagent/profiles/<profile>/sessions`).                                                                                                    |
| `@debug`                 | Wait-for-debugger and other developer hooks.                                                                                                                                                                  |
| `@display`               | Tweak how output is rendered.                                                                                                                                                                                 |
| `@env`                   | Inspect environment variables and config-relevant runtime values.                                                                                                                                             |
| `@exit`                  | Exit the program.                                                                                                                                                                                             |
| `@explain`               | Explanation of cached translations                                                                                                                                                                            |
| `@feedback`              | Inspect and export user-feedback entries                                                                                                                                                                      |
| `@grammar`               | Manage runtime-learned grammar rules (list/show/delete/clear) and scan loaded grammars for cross-agent collisions (`@grammar collisions [--json <path>]`, NFA product-construction with concrete witnesses).  |
| `@help`                  | Inline help for any command.                                                                                                                                                                                  |
| `@history`               | Chat history management — list/clear/delete/save/insert + entity inspection.                                                                                                                                  |
| `@index`                 | Image / memory indexing controls.                                                                                                                                                                             |
| `@memory`                | Conversation-memory operations (RAG store maintenance).                                                                                                                                                       |
| `@notify`                | Notification stream control.                                                                                                                                                                                  |
| `@open`                  | Open a file or folder via the host.                                                                                                                                                                           |
| `@package`               | Manage installed external app agents and their install sources: `list`, `install`, `update`, `uninstall`, and the `source` group (list/order/where/add/remove). Available only when an installer is injected. |
| `@ports`                 | List all registered TCP ports (per `(agent, role, port)` group) with the agent-server's own listen port and the current # of clients connected.                                                               |
| `@random`                | Issue a random sample request from a pre-generated dataset (or LLM-generated).                                                                                                                                |
| `@reason` / `@reasoning` | Invoke the reasoning engine (Claude or Copilot) with an optional `--model` override.                                                                                                                          |
| `@run`                   | Execute a script of dispatcher commands in sequence.                                                                                                                                                          |
| `@session`               | Local dispatcher session management — create/open/list/info/reset/clear/delete (lower-level than `@conversation`).                                                                                            |
| `@settings`              | User-level settings (theme, etc.).                                                                                                                                                                            |
| `@shutdown`              | Shut down the agent server and exit.                                                                                                                                                                          |
| `@token`                 | Token-counter inspection.                                                                                                                                                                                     |
| `@trace`                 | Add a `debug` trace pattern.                                                                                                                                                                                  |

Each command has a `CommandDescriptor` that defines expected parameters,
subcommands, and help text.

The system agent also has sub-agents with LLM-translated action schemas:

- **`system.config`** — Natural language configuration changes.
- **`system.conversation`** — Natural language management of **agentServer client-connection
  conversations** (the named, GUID-keyed sessions described in
  [agentServerConversations.md](../agents/agentServerConversations.md)). Despite the name, this has
  **no relation** to the dispatcher's own internal `@session` command, which manages
  local dispatcher state (agent settings, construction cache, config) stored under
  `~/.typeagent/profiles/<profile>/sessions/`. `system.conversation` is the NL front-end
  for `@conversation`; `@session` is a separate, lower-level command for dispatcher
  internals.

  `system.conversation` supports six action types: `newConversation`, `listConversation`,
  `showConversationInfo`, `switchConversation`, `renameConversation`, and `deleteConversation`.
  These let users say things like "switch to my work conversation", "rename this
  conversation to project notes", or "delete the old project conversation" instead of
  using `@conversation` commands directly. Because the dispatcher cannot access
  the agent-server RPC layer directly, `executeConversationAction` bridges to the client
  via `ClientIO.takeAction(requestId, "manage-conversation", payload)` where
  `payload` is one of:

  ```
  { subcommand: "new";    name?: string }
  { subcommand: "list" }
  { subcommand: "info" }
  { subcommand: "switch"; name: string }
  { subcommand: "rename"; name?: string; newName: string }
  { subcommand: "delete"; name: string }
  ```

  The CLI handles this by calling `handleConversationCommand`; the Shell
  calls the corresponding `ClientAPI` session methods over IPC.

### Dispatcher agent

Handles meta-actions that the dispatcher itself fulfills:

- **Unknown action** — When no agent can handle a request
- **Clarification** — When the input is ambiguous
- **Multiple actions** — When the LLM identifies multiple intents
- **Search/lookup** — Finding the right agent for a request

---

## Session & persistence

### `Session`

The `Session` object stores persistent configuration that survives across
requests and can be saved to disk:

- **Translation** — LLM model selection, schema generation strategy,
  streaming mode, history depth
- **Cache** — Whether to use construction/grammar matching, wildcard
  expansion settings
- **Explainer** — Model and settings for explaining cached translations
- **Clarification** — Rules for when to ask the user for clarification
- **Memory** — Whether to extract knowledge from requests and results
- **Agent state** — Per-agent/schema enabled/disabled flags

Sessions are stored in `~/.typeagent/sessions/` and loaded at startup.

### `ChatHistory`

Tracks the conversation log:

- User requests and assistant responses
- Named entities extracted from exchanges
- User-provided instructions
- Activity context markers

Used to build `HistoryContext` for context-aware translation and to
feed conversation memory.

### `ConversationMemory`

A structured RAG system (via the `knowledge-processor` package) that
extracts facts and entities from action results. Powers:

- Entity resolution during action execution
- Wildcard validation in cache matching
- Context-aware translation via history

### `DisplayLog`

A sequence-numbered log of all output displayed to the user. Supports:

- Streaming access (fetch entries after a sequence number)
- Session replay (reconstructing display history)
- Remote client synchronization via RPC

---

## RPC layer

The RPC package enables remote clients (e.g., the Electron shell running
the dispatcher in a separate process):

```
┌──────────────┐         RPC Channel          ┌───────────────────┐
│  Shell/CLI   │ ◄━━━━━━━━━━━━━━━━━━━━━━━━━►  │  Dispatcher       │
│              │                              │                   │
│  Dispatcher  │  submitCommand  ──────────►  │  DispatcherServer │
│  Client      │  getCompletion  ──────────►  │                   │
│              │                              │                   │
│  ClientIO    │  ◄──────────── appendDisplay │  ClientIO Client  │
│  Server      │  ◄──────────── proposeAction │                   │
└──────────────┘                              └───────────────────┘
```

Two RPC pairs are involved:

1. **Dispatcher RPC** — The shell calls dispatcher methods
   (`submitCommand`, `getCommandCompletion`, etc.) via
   `DispatcherClient` → `DispatcherServer`. The `submitCommand` wire
   payload omits the `completion` promise (promises can't be
   serialized); the RPC client synthesizes a fresh `completion`
   wired to the host's `commandComplete` / `requestCancelled` push
   events before handing the result to the caller — see
   [`messageQueueing.md`](./messageQueueing.md) §14.1.
2. **ClientIO RPC** — The dispatcher calls display methods
   (`appendDisplay`, `proposeAction`, etc.) via
   `ClientIOClient` → `ClientIOServer`.

This inversion means the dispatcher can push display updates to the
client without polling.

---

## Request lifecycle

A complete request lifecycle, from keystroke to result:

```
1. User types "play Yesterday by the Beatles"
2. Shell calls dispatcher.submitCommand("play Yesterday by the Beatles")
3. submit returns {ok:true, entry} where entry is a SubmittedRequest carrying
   entry.completion; queue drain dispatches the entry,
   processCommand pipeline acquires commandLock, creates AbortController
4. normalizeCommand() → "@dispatcher play Yesterday by the Beatles"
5. resolveCommand() → no matching command → natural language request
6. interpretRequest() entered
7.   matchRequest() → agentCache.match()
8.     Grammar NFA matches "play $(track) by $(artist)" rule
9.     Wildcards validated: track="Yesterday", artist="the Beatles"
10.    Cache hit → InterpretResult { fromCache: "grammar" }
11. executeActions() entered
12.   toPendingActions() → resolve entities (none pending)
13.   canExecute() → player schema is active ✓
14.   executeAction({ actionName: "play", parameters: { track: "Yesterday", artist: "the Beatles" } })
15.     No flow registered → call playerAgent.executeAction()
16.     Agent returns ActionResult with display content
17.   Display result via clientIO.appendDisplay()
18.   Extract entities → conversationMemory
19.   Collect metrics
20. endProcessCommand() → return CommandResult
21. Release commandLock
```

If step 8 had missed (no grammar match), the flow would continue:

```
8'. translateRequest() entered
9'.   pickInitialSchema() → semantic search → "player" schema
10'.  translateWithTranslator() → LLM call with schema + history
11'.  LLM returns { actionName: "play", parameters: { track: "Yesterday", artist: "the Beatles" } }
12'.  finalizeAction() → action is valid, no switch needed
13'.  Cache translation as construction for future matches
14'.  Continue from step 11 above
```

---

## Error handling

The dispatcher uses structured error handling at several levels:

- **Command lock** — A `Limiter` ensures only one command executes at a
  time. Concurrent requests queue behind the lock.
- **Cancellation** — Each request gets an `AbortController` whose signal
  propagates through the translation and execution pipeline (LLM fetch,
  streaming chunks, cache validation). Two cancellation paths exist:
  - `cancelCommand(requestId)` — cancel by the server-assigned UUID, available
    after `setUserRequest()` fires. Used by Escape/Ctrl+C once a request is running.
  - `cancelCommandByClientId(clientRequestId)` — cancel by the client-assigned
    id passed as the fourth argument to `submitCommand()`. This AbortController
    is created before the command lock is acquired, so it can abort a command
    that is queued behind another in-flight command before `setUserRequest()` fires.
- **Unknown actions** — When no agent matches, the dispatcher displays
  an error and uses semantic search to suggest the closest matching
  agents/schemas.
- **Disabled schemas** — `canExecute()` checks that all target schemas
  are active before execution. Disabled schemas produce user-visible
  errors with guidance on enabling them.
- **Translation failures** — LLM errors are caught and surfaced via
  `clientIO.appendDisplay()`. The dispatcher does not retry automatically.
- **Agent errors** — Exceptions from `executeAction()` are caught,
  logged, and displayed without crashing the session.

---

## Dependencies

The dispatcher integrates with several sibling packages:

| Package                    | Integration point                                 |
| -------------------------- | ------------------------------------------------- |
| `@typeagent/agent-sdk`     | `AppAgent` interface that all agents implement    |
| `@typeagent/action-schema` | Parses TypeScript schemas into `ActionSchemaFile` |
| `action-grammar`           | NFA/DFA grammar compilation and matching          |
| `agent-cache`              | Construction cache and grammar store              |
| `aiclient`                 | LLM API calls (Azure OpenAI, OpenAI, Claude)      |
| `knowledge-processor`      | Structured RAG for conversation memory            |
| `telemetry`                | Event logging and performance metrics             |
| `@typeagent/agent-rpc`     | RPC channel abstraction                           |
