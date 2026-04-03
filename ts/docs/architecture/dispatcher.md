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
  processCommand(
    command,
    clientRequestId?,
    attachments?,
    options?,
  ): Promise<CommandResult | undefined>;
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

Every user interaction enters through `processCommand()`, which acquires
a command lock (ensuring serial execution), sets up request tracking, and
delegates to the resolution → translation → execution pipeline.

### 1. Command resolution

```
processCommand(input)
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

## Built-in agents

The dispatcher registers two built-in agents via `inlineAgentProvider`:

### System agent

Handles `@`-prefixed system commands:

- `@config` — Session configuration (models, caching, agents)
- `@help` — Help and documentation
- `@history` — Chat history management
- `@trace` — Debug tracing
- `@clear` — Clear display
- `@notify` — Notification management
- `@construction` — Cache construction management
- `@explain` — Explanation of cached translations

Each command has a `CommandDescriptor` that defines expected parameters,
subcommands, and help text.

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
│  Dispatcher  │  processCommand ──────────►  │  DispatcherServer │
│  Client      │  getCompletion  ──────────►  │                   │
│              │                              │                   │
│  ClientIO    │  ◄──────────── appendDisplay │  ClientIO Client  │
│  Server      │  ◄──────────── proposeAction │                   │
└──────────────┘                              └───────────────────┘
```

Two RPC pairs are involved:

1. **Dispatcher RPC** — The shell calls dispatcher methods
   (`processCommand`, `getCommandCompletion`, etc.) via
   `DispatcherClient` → `DispatcherServer`.
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
2. Shell calls dispatcher.processCommand("play Yesterday by the Beatles")
3. processCommand() acquires commandLock, creates AbortController
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
- **Cancellation** — Each request gets an `AbortController`. Calling
  `cancelCommand(requestId)` signals the abort, which propagates through
  the translation and execution pipeline.
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
