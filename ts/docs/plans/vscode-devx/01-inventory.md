# TypeAgent VS Code Developer Experience — Phase 1 Inventory

> **Status:** Discovery (Phase 1 of 4) — read-only inventory. No code changes proposed yet.
> **Audience:** Planning material for designing a unified VS Code experience that helps developers who are **not** TypeAgent natives onboard, author, debug, and analyze agents.
> **Companions (planned):** `02-journeys.md` (developer journeys), `03-features.md` (VS Code feature surface), `04-roadmap.md` (sequencing).

This document is a synthesis of six exploratory sweeps across the monorepo. Per-package detail is preserved; the goal is to make it possible to design Phase 2 without re-reading the source.

---

## 0. Cross-cutting observations (read this first)

These are the patterns that recur across every sweep and that should shape the VS Code story.

1. **The platform already has good _library_ boundaries; the _experience_ boundaries are missing.**
   `grammar-tools/core`, `agent-cache`, `agent-dispatcher`, `knowPro`, `telemetry`, `aiclient` all have clean programmatic surfaces. What's missing is a single, discoverable entry point that ties them together for a newcomer. Today, each tool is a separate door.

2. **There are already three VS Code touchpoints and a half-formed Electron parallel.**

   - `extensions/agr-language` — full LSP + webview debug panel for `.agr` (most mature dev-tooling extension).
   - `packages/vscode-shell` — chat sidebar/panels, agentServerBridge.
   - `packages/coda` — VS Code command-routing target (mostly stubbed).
   - `packages/shell` — Electron app reusing the same `chat-ui` / `completionUI` libraries.
     These are not coordinated; they each register their own commands, keybindings, and webviews. A unified experience must either merge or orchestrate them.

3. **Agent authoring is hand-wired in too many places.**
   A new agent requires edits to: `package.json` exports (×2 paths, source vs dist), `tsconfig.json`, `<name>Manifest.json`, `<name>Schema.ts`, `<name>Schema.agr`, `<name>ActionHandler.ts`, **plus** `packages/defaultAgentProvider/data/config.json` **and** `packages/defaultAgentProvider/package.json` dependencies. Mistakes in any of these silently fail at runtime, not at build time.

4. **Two cache systems coexist; both are observable but neither is well exposed.**
   `completionBased` (`ConstructionCache`) and `nfa` (`GrammarStore`) are toggled at runtime via `@config cache.grammarSystem`. Both persist to `~/.typeagent/sessions/<id>/{constructions,grammars}/*.json`. `cacheExplorer` exists as a standalone webpack page; it is not surfaced anywhere a developer naturally looks.

5. **An RPC-shaped boundary already runs through everything: `agent-server` ⟷ clients.**
   CLI, Shell, vscode-shell, Coda, and the Copilot plugin all talk to `agentServer` over WebSocket via `@typeagent/agent-server-client`. The dispatcher can also embed in-process. **Implication:** VS Code can choose either model without inventing new transport.

6. **Major design work is already underway — must integrate, not duplicate.**

   - `docs/plans/grammar-tools/` — multi-phase plan with 5 ADRs (Lit for shared UI, opt-in trace hook, etc.). Tracks 0–E (foundation + VS Code) are essentially done; F–H (web app + shell) gated. **Our plan must extend this, not reinvent it.**
   - `docs/design/workflowSystem/` — adopted v1 IR for workflow system (P1–P5 principles, JSON IR as compile target).
   - `CONFIGURATION_AND_PERSISTENCE.md` — runtime cache-system switching, automatic cache population.

7. **Telemetry exists but is invisible.**
   Every layer logs `typeagent:*` debug namespaces and emits `LogEvent`s through pluggable sinks (Debug / Cosmos / Mongo / generic DB). Profiler timelines are available. No in-VS Code surface. `examples/commandHistogram` is the only example of consuming this data.

8. **Hidden "examples/" gold mine.**
   `examples/schemaStudio` (LLM-driven schema/phrase generation with rich interactive commands), `examples/cacheRESTEndpoint` (HTTP wrapper for cache exploration), `examples/commandHistogram` (telemetry analysis), `examples/vscodeSchemaGen` (auto-generate schemas from VS Code command metadata), `examples/memoryProviders` (alt storage backends), `examples/spelunker`, `examples/docuProc`. Most of these need to be folded — at least conceptually — into the unified experience.

8b. **Major in-flight work: action collision detection & analysis** (branch `dev/robgruen/action_collision`).
A substantial schema-analysis/optimization system is about to land. It is the **third pillar** of the dev experience alongside grammar tools and schema authoring — see §10 for full detail. Headline impact: introduces the `@collision *` and `@grammar collisions` command families, three rich interactive HTML reports (collision hotspots, recovery breakdown, neighborhoods preview), runtime collision telemetry into the existing logger pipeline, and four runtime detection points with resolution strategies. **Any VS Code plan must absorb this as a first-class surface.**

8c. **"Create an agent for X" already works via MCP — from outside TypeAgent.**
TypeAgent is registered as an MCP server with both Claude and Copilot today (`packages/copilot-plugin` direct + MCP modes; `packages/commandExecutor` exposes `typeagent_action`). The `packages/agents/onboarding/` agent — which orchestrates Discovery → PhraseGen → SchemaGen → GrammarGen → Scaffolder → Testing → Packaging — is invokable from those LLM hosts via natural language ("create an agent for X"). **Implication for the VS Code plan:** the primary "New Agent" surface should be _conversational_, reusing the same `onboarding` agent, not a form-based wizard. The MCP integration also means the VS Code experience should consider being an **MCP host** itself (so a developer can ask Copilot Chat from inside VS Code) and/or remain an **MCP server** (so the chat participant in vscode-shell can invoke onboarding through the same path). See §11.

8d. **Just-landed in-flight work: user feedback mechanism** (PR #2341, merged 2026-05-14 from `dev/robgruen/user_feedback` → `main`, +3409 / −22 lines).
Adds a **fourth telemetry stream alongside the three already cataloged in §3** — and the only one that produces **human-labeled ground truth**. Components:

- **chat-ui + shell renderer:** per-bubble 👍/👎 with optional `wrong-agent | didnt-understand | bad-response | other` category, free-text comment, and an opt-in "share my prompt and the response" checkbox; trash icon for bubble-hide / visibility management (user-side and agent-side toggle independently).
- **Dispatcher:** new RPCs `recordUserFeedback`, `recordUserHide`, `restoreAllHidden`, `flushHidden`; **ClientIO broadcast** (`onUserFeedback` / `onUserHide`) so multi-window setups stay in sync.
- **Persistence:** entries appended to the per-session `displayLog.json` as `user-feedback` and `user-message-hidden` entry variants (append-only, last-wins).
- **Telemetry:** every rating fires `Logger.logEvent("userFeedback", payload)`; when context-sharing is opted in, the payload carries the full prompt/responses/action JSON via `gatherFeedbackContext`.
- **Defaults flipped:** `dblogging` is now `true` by default in `agentServer/server.ts` and `commandHandlerContext.ts` — feedback events flow to Cosmos/Mongo sinks out of the box.
- **Command handlers:** `@feedback list`, `@feedback top`, `@feedback filter`, `@feedback export`, `@feedback count`; plus `@shell trash restore` / `@shell trash flush` for the hide-bin lifecycle.
  **Why this matters strategically:** the inventory's three existing telemetry streams (`debug("typeagent:*")`, `Logger.logEvent()` sinks, collision events from 8b) are all machine-generated _observations_. Feedback is **the only labeled-by-humans signal tied to a specific (request, response) pair**. It is therefore the natural quality oracle for any compare-and-replay / regression-finding journey: it tells you not just "behavior changed between vA and vB" but "behavior changed _and the user said it was wrong_ (or right)." Any VS Code plan must absorb this as a first-class data source. See §12 for full detail.

9. **No "agent health check" exists.**
   Probably the single highest-leverage diagnostic: given an agent folder, validate manifest ↔ schema ↔ grammar ↔ handler ↔ provider-registration coherence. Today this is "fails at runtime with a vague message."

10. **The dev loop is opinionated and works, but undocumented for newcomers.**
    `fluid-build` + `tsc -b` + `asc` + `agc` chain is correct and incremental, but a non-native developer doesn't know which scripts matter or why tests run from `dist/test/`. The `.env` story is split across `ts/.env`, `agentServerConfig.json`, `user-settings.json`, six config-file precedence locations, and aiclient's env-var pool discovery.

---

## 1. Schema & Grammar authoring (Sweep A)

### Core packages

| Package                          | Role                                                                                                                                                                                                                                        | Surface for VS Code                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/actionSchema`          | Parses `.ts` action types → `ParsedActionSchema` AST → JSON schema                                                                                                                                                                          | `parseActionSchemaSource()`, `validateAction()`, `generateActionJsonSchema()` — clean library                                                                                                                       |
| `packages/actionSchemaCompiler`  | CLI `asc`: `.ts` → `.pas.json`                                                                                                                                                                                                              | oclif CLI; could wrap as VS Code command/task                                                                                                                                                                       |
| `packages/actionGrammar`         | `.agr` parser + NFA/DFA compiler + matcher; supports entity types, value expressions, optimization pipeline                                                                                                                                 | `loadGrammarRules()`, `parseGrammarRules()`, `writeGrammarRules()` (formatter), `matchGrammar()`. Also: LLM-powered `ClaudeGrammarGenerator` / `SchemaToGrammarGenerator` (CLI: `generate-grammar`, `test-grammar`) |
| `packages/actionGrammarCompiler` | CLI `agc`: `.agr` → `.ag.json` (with `--debug` flag to keep 1:1 source mapping)                                                                                                                                                             | CLI                                                                                                                                                                                                                 |
| `packages/grammarTools/core`     | **Framework-agnostic language services** wrapping actionGrammar: `loadGrammarFromFile/Buffer`, `getSymbolIndex`, `format`, `previewCompletion`, `traceMatch`, `computeCoverage`, `diffGrammars`. Result types are discriminated unions (`Ok | Err`).                                                                                                                                                                                                              | Designed to be transported over RPC/HTTP/IPC. Trace & coverage pending PartId assignment. |
| `packages/grammarTools/ui`       | Lit web component library: `gt-debug-panel`, `gt-completion-panel`, `gt-rule-list`, `gt-trace-timeline`, `gt-coverage-heatmap`, `gt-diff-view`, `gt-source-view`. Pluggable `GrammarBackend`.                                               | Embeddable in webview. Coverage/diff partially stubbed.                                                                                                                                                             |
| `packages/grammarTools/cli`      | Stub CLI wrapper around core                                                                                                                                                                                                                | Not yet implemented                                                                                                                                                                                                 |
| `packages/schemaAuthor`          | LLM-powered phrase/schema variation generation (Claude)                                                                                                                                                                                     | `generateActionPhrases()`. Used by `examples/schemaStudio`. No UI.                                                                                                                                                  |

### Existing VS Code support

- **`extensions/agr-language`** (most mature): TextMate grammar for `.agr`, LSP server (diagnostics, defs, refs, hover, format, doc symbols), commands `agr.openDebugPanel`, `agr.traceMatch`, `agr.showCoverage`, `agr.clearCoverage`, `agr.diffGrammars`. Webview built with Vite, embeds `grammarTools/ui` components. **Status:** trace/coverage partially complete (PartId assignment pending).

### Example-directory contents folded in

- **`examples/schemaStudio`** — interactive REPL with `@schema`, `@fromSchema`, `@variations`, `@template`, `@urlResolver`, `@urlValidate`, `@generateSettingsSchemas`, `@batchPopulate`, `@mergeCache`. **Substantial functionality to surface in VS Code.**
- **`examples/vscodeSchemaGen`** — pipeline: VS Code commands JSON → normalize → generate `.ts` schema + embeddings. Pattern for bootstrapping schemas from external metadata.
- **`examples/playground`** — minimal TypeChat chatbot reference.
- **`examples/searchActionTest`** — semantic search test harness.

### File types

| Extension             | Owner                            | Editor support today                             |
| --------------------- | -------------------------------- | ------------------------------------------------ |
| `.ts` (action schema) | `actionSchema`                   | TS built-in only; **no schema-aware validation** |
| `.pas.json`           | `actionSchemaCompiler`           | None                                             |
| `.agr`                | `actionGrammar` / `agr-language` | TM grammar + LSP ✓                               |
| `.ag.json`            | `actionGrammarCompiler`          | None                                             |

### Data flow

```
.ts schema  →[asc]→  .pas.json  ──┐
                                   ├──→ runtime: dispatcher loads, registers in cache/grammar
.agr grammar →[agc]→ .ag.json  ────┘
                  ↑
       (Claude can generate .agr from .pas.json via SchemaToGrammarGenerator)
```

---

## 2. Dispatch & Runtime (Sweep B)

### The contract

```ts
interface AppAgent {
  initializeAgentContext?(settings?): Promise<unknown>;
  updateAgentContext?(enable, context, schemaName): Promise<void>;
  closeAgentContext?(context): Promise<void>;
  checkReadiness?(context): Promise<ReadinessReport>;   // "ready" | "setup-required" | "unsupported"
  setup?(settings, context): Promise<ActionResult>;
  handleChoice?(choiceId, choice, context): Promise<ActionResult>;
  executeAction?(action, context): Promise<ActionResult>;
  streamPartialAction?(action, context): AsyncGenerator<...>;
  getCommands?(): CommandDescriptors;
  executeCommand?(...): Promise<ActionResult>;
  resolveEntity?(entity, context): Promise<ResolveEntityResult>;
  validateWildcardMatch?(action, context): Promise<boolean>;
  getActionCompletion?(action, context): Promise<CompletionGroups>;
  getCommandCompletion?(prefix, context): Promise<CompletionGroups>;
  getDynamicDisplay?(type, displayId, context): Promise<DynamicDisplay>;
}
// + an exported function:  export function instantiate(): AppAgent
```

### Key packages

| Package                         | Role                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dispatcher`           | Core orchestration. `createDispatcher(options) → Dispatcher`. Methods: `processCommand`, `getCommandCompletion`, `checkCache`, `getDynamicDisplay`, `getStatus`, `getAgentSchemas`, `respondToChoice`, `getDisplayHistory`, `cancelCommand`. Splits into `agent-dispatcher`, `@typeagent/dispatcher-types`, `@typeagent/dispatcher-rpc`, `dispatcher-node-providers`. |
| `packages/agentSdk`             | `AppAgent` interface + manifest types + `ActionIO` (setDisplay/appendDisplay with text/markdown/html/iframe/table). Storage abstraction (`instanceStorage` cross-conversation, `sessionStorage` per-session).                                                                                                                                                         |
| `packages/agentSdkWrapper`      | `loadSchemaInfo()`, `SchemaToGrammarGenerator`, `shouldUseTypedWildcard()`.                                                                                                                                                                                                                                                                                           |
| `packages/agentServer`          | WebSocket daemon. Multi-conversation: `createConversation`, `joinConversation`, `listConversations`, `renameConversation`, `deleteConversation`. Per-conversation lazy `SharedDispatcher`, idle-evict at 5min. Discovery file at `~/.typeagent/server-discovery.json`.                                                                                                |
| `packages/agentRpc`             | Generic typed `createRpc()` over `RpcChannel`. Used everywhere.                                                                                                                                                                                                                                                                                                       |
| `packages/defaultAgentProvider` | `getDefaultAppAgentProviders()`. NPM-based loading via `package.json` exports (`./agent/manifest` → JSON, `./agent/handlers` → JS). Configured via `data/config.json`.                                                                                                                                                                                                |
| `packages/agent-flows`          | TaskFlow / WebFlow / PowerShell sandbox + execution; dynamic grammar generation for workflows.                                                                                                                                                                                                                                                                        |
| `packages/cli`                  | oclif-based REPL. `agent-cli connect`, `conversations create/list/switch`, `run <action>`, `/conversation`, `@<agent>`. Markdown via `marked-terminal`.                                                                                                                                                                                                               |
| `packages/api`                  | REST shim (`POST /api/processCommand`).                                                                                                                                                                                                                                                                                                                               |
| `packages/commandExecutor`      | Sandboxed shell command runner. Also exposes an MCP server (`typeagent_action` tool) for Claude.                                                                                                                                                                                                                                                                      |

### Process model options for VS Code

- **Embedded**: extension creates `createDispatcher()` in-process.
- **Remote**: extension connects to `agentServer` over WebSocket (already implemented in `vscode-shell`'s `agentServerBridge.ts`).
- **Hybrid**: some agents embedded, others remote.

### Storage layout

```
~/.typeagent/
  agentServerConfig.json
  user-settings.json
  .IdentityService/typeagent-tokencache
  server-<port>.pid
  server-discovery.json
  profiles/<profile>/
    <agentName>/                       # cross-conversation: tokens, config, workflows
    conversations/
      conversations.json
      <conversationId>/
        sessions/<sessionId>/
          data.json
          constructions/default.json   # completionBased cache
          grammars/dynamic.json        # nfa cache
          memory/<conversationName>/...
  sessions/<timestamp>-<n>/            # legacy/local-mode sessions
```

### End-to-end "new agent" steps (today)

1. Create folder under `packages/agents/<name>/`.
2. Write `package.json` with `"./agent/manifest"` → `src/<name>Manifest.json` and `"./agent/handlers"` → `dist/<name>ActionHandler.js`.
3. Write `tsconfig.json` extending `../../../tsconfig.base.json`.
4. Write `<name>Manifest.json` (`emojiChar`, `description`, `schema.{schemaType, schemaFile, grammarFile}`).
5. Write `<name>Schema.ts` exporting union type matching `schemaType`.
6. Write `<name>Schema.agr` importing the schema, with rules returning the action types.
7. Write `<name>ActionHandler.ts` exporting `instantiate(): AppAgent`.
8. Add to `packages/defaultAgentProvider/data/config.json`.
9. Add to `packages/defaultAgentProvider/package.json` dependencies as `"workspace:*"`.
10. `pnpm i` then `pnpm run build`.
11. Test via CLI or shell.

---

## 3. Cache, Knowledge, Memory, Telemetry (Sweep C)

### Cache (`packages/cache`)

- **Two systems** both live: `ConstructionCache` (completionBased) + `GrammarStore` (NFA).
- Persisted under `~/.typeagent/sessions/<sid>/{constructions,grammars}/*.json`.
- Inspectable APIs: `ConstructionCache.fromJSON()`, `ConstructionStore.getInfo()`, `GrammarStoreImpl.getGrammar()`, `AgentCache.match(request)`, `AgentCache.getInfo()`.
- Existing UI: `packages/cacheExplorer` (DOM-based hierarchy viewer), `examples/cacheRESTEndpoint` (HTTP wrapper, sample at `data/v5_sample.json`).
- Telemetry: emits `cache:explanation` and `cache:construction` events.

### Knowledge / RAG (`packages/knowPro`, `packages/kp`, `packages/knowledgeProcessor`)

- Structured RAG: extracts entities, topics, actions, temporalRefs from messages.
- Indexes: term→semanticRef, timestamps, text locations, related terms, property-value.
- APIs: `search(SearchQuery)`, `searchWithLanguage(query)`, `getAnswerFromLanguage(question)`, `addMessage`, `buildIndex`.
- `kp` package adds keyword extraction, group/inverted indexes, query engine, LLM enrichment.
- Visualization: `packages/knowledgeVisualizer` (D3 + word cloud, experimental).

### Memory (`packages/memory`)

- `ConversationMemory`, `DocumentMemory`, `ImageMemory`, `WebsiteMemory`.
- Storage backends (`packages/memory/storage`): in-memory, SQLite, Azure Search. `IStorageProvider` interface — DI'able.
- `~/.typeagent/memory/<conversationName>/{messages.json, semanticRefs.json, indexes/*, embeddings.db}`.
- `packages/knowProTest` exposes `@kpSearch*`, `@kpAnswer*`, `@kpPodcast*`, `@kpEmail*` test commands.

### Telemetry (`packages/telemetry`)

- `Logger` / `ChildLogger` / `MultiSinkLogger` with sinks:
  - `DebugLoggerSink` → `debug` package (`typeagent:logger:<event>`).
  - `CosmosDBLoggerSink` — batched, exponential backoff.
  - `MongoDBLoggerSink` — same pattern.
  - `DatabaseLoggerSink` — generic.
- `createProfileLogger()` for timeline-style profiling (start/measure/mark/stop, hierarchical).
- Cache, dispatcher, aiclient all log into this pipeline.

### AI Client (`packages/aiclient`)

- Endpoint pool: env-var discovery (`AZURE_OPENAI_ENDPOINT_<MODEL>_<REGION>[_PTU]`).
- Priority tiers (PTU=1, regional PAYG=2+), random within tier.
- Cooldown: 429 → parse Retry-After + exponential backoff (cap 120s), 5xx → 5s, 4xx → fail fast.
- Supports keyless (`"identity"` value → DefaultAzureCredential).
- Debug: `DEBUG=typeagent:pool,typeagent:rest:retry`.

### Examples folded in

- `examples/memoryProviders` — alt SQLite/Elastic backends.
- `examples/commandHistogram` — telemetry DB analysis (Cosmos/Mongo).
- `examples/spelunker`, `examples/docuProc` — domain-specific memory ingestion.
- `examples/classify` — classification example.
- `examples/chat` — KnowPro test harness.
- `examples/mcpMemory` — MCP wrapper for memory.

---

## 4. Existing UI / shell / editor surfaces (Sweep D)

### `packages/shell` (Electron)

- electron-vite + plain TS DOM (no React). Renderer composed of `chatView`, `chatInput`, `tabView`, `searchMenuView/UI`, `settingsView`, `helpView`, `metricsView`, `cameraView`, `messageContainer`, `partial`, `choicePanel`.
- Main process: local Whisper STT, Azure Speech TTS, PDF viewer, electron-updater, multi-window.
- Connects to agent-server over WebSocket.

### `packages/vscode-shell`

- Sidebar `WebviewViewProvider` + ephemeral `WebviewPanel`s.
- Commands: `openChat`, `newChatPanel`, `focusChat`, `switchSession`, `newSession`, `renameSession`, `deleteSession`, `clearChat`, `runDemo`, `demoContinue`, `demoCancel`.
- Keybindings: `Ctrl+K Ctrl+T/N/S/R/L`.
- Settings: `typeagent.serverUrl`, `typeagent.autoStart`, `typeagent.serverPort`.
- Uses `packages/chat-ui` + `packages/completionUI` (already-shared libraries).
- Per-session `agentServerBridge`.

### `packages/coda`

- Activates `onStartupFinished`. Maps dispatcher actions → VS Code commands. Mostly stubbed (only 2 registered commands; handlers for editor / workbench / debug / extension exist as scaffolds).
- Connects to `ws://localhost:8999`.

### Shared libraries

- `packages/chat-ui` — DOM/markdown rendering (`markdown-it` + `ansi_up`). Platform-agnostic.
- `packages/completionUI` — `SearchMenuUI`, `CompletionToggle`. Zero deps.

### `packages/copilot-plugin`

- Two integration modes: direct (WebSocket) and MCP. MCP server exposes `typeagent-processCommand`. Hooks: `userPromptSubmitted`, `agentStop`, `preToolUse`, `postToolUse`.

### Other UI

- `packages/cacheExplorer` — webpack-served tree explorer.
- `packages/knowledgeVisualizer` — D3 word cloud.
- `examples/viewList` — list-agent visualization.
- `examples/cacheRESTEndpoint` — cache HTTP server.

### `extensions/agr-language`

See §1. **The most fully-realized dev-tooling extension; the architecture template for whatever we build next.**

### Gap analysis: today's `vscode-shell + coda` user

- ✅ Chat with dispatcher; run agent commands; basic `.agr` editing via `agr-language`; cache UI standalone.
- ❌ No schema editor; no integrated grammar debug _for the agent currently in focus_; no agent scaffolder; no cache/knowledge inspector inside VS Code; no demo recording; no schema testing; no agent-health diagnostic; coda action handlers mostly stubs; no project-tree understanding of the agent layout.

---

## 5. Agent examples & onboarding (Sweep E)

### Minimum viable agent — exact boilerplate

6 source files: `package.json`, `tsconfig.json`, `<name>Manifest.json`, `<name>Schema.ts`, `<name>Schema.agr`, `<name>ActionHandler.ts`. Plus dist outputs. Plus two registration edits in `defaultAgentProvider`.

### Pattern catalog (from `docs/architecture/agent-patterns.md` + observed code)

| Pattern                  | Defining features                                            | Examples                                                   |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- |
| schema-grammar (default) | Schema + grammar + handler                                   | weather, photo, list, image, utility                       |
| external-api             | + `Bridge.ts`, OAuth, token persistence                      | calendar, email, player                                    |
| llm-streaming            | `injected: true`, `cached: false`, `streamingActions: [...]` | chat, greeting                                             |
| sub-agent-orchestrator   | `subActionManifests` map + `actions/` subfolder              | code (6 subgroups), desktop                                |
| websocket-bridge         | Internal WS server for host app RPC                          | browser, code                                              |
| state-machine            | `handleChoice` gates + phase tracking                        | onboarding, powershell                                     |
| native-platform          | OS/device bindings                                           | androidMobile, playerLocal, osNotifications, screencapture |
| view-ui                  | `localView: true`, `localHostPort`, `views/`                 | turtle, montage, markdown                                  |
| command-handler          | `commandDefaultEnabled` + `executeCommand`                   | settings, test                                             |

### Friction hotspots (in priority order for tooling intervention)

1. **`package.json` exports** — `./agent/manifest` must point to source JSON; `./agent/handlers` must point to dist JS. Wrong → silent runtime failure.
2. **`schemaType` literal must match exported TS type name** — silent failure if mismatched.
3. **Grammar variable names must equal schema parameter names** — no compile-time check today.
4. **Dual registration** — config.json + dependencies in `defaultAgentProvider`. Easy to do one but not the other.
5. **Build order** — `tsc + asc + agc` via `concurrently`. Need fresh build before each test, since Jest runs from `dist/test/`.
6. **Hidden conventions** — file naming (`<name>Schema.ts`, `<name>ActionsSchema.ts` for sub-schemas), copyright header on every .ts/.js, ESM `.js` import extensions, 4-space indent.

### Existing developer aids

- **`packages/agents/onboarding/`** — an end-to-end _agent_ that scaffolds other agents via LLM. Phases: Discovery → PhraseGen → SchemaGen → GrammarGen → Scaffolder → Testing → Packaging. **Highly relevant; the brains of any future VS Code scaffolder.**
- `cliHandlerTemplate.ts` in onboarding/scaffolder/ — string template for CLI-wrapper agents.
- No standalone CLI scaffolder; no VS Code command for "New Agent."

---

## 6. Docs, plans, dev loop (Sweep F)

### Architecture docs (descriptive/normative)

- `actionGrammar.md` — `.agr` spec (normative for compiler/matcher).
- `dispatcher.md` — orchestration spec.
- `agent-patterns.md` — 9 patterns.
- `agentServerConversations.md` — conversation model & on-disk layout.
- `completion.md` — backend-authoritative completion contract (`startIndex`, `closedSet`, etc.).
- `browserAgent.md`, `browserRpc.md`, `browserScenarios.md` — most complex agent reference.
- `user-settings.md` — `~/.typeagent/user-settings.json`.
- `workflows.md` — TaskFlow / WebFlow / PowerShell.

### Plans / design (must integrate)

- **`docs/plans/grammar-tools/`** — multi-phase plan. Tracks 0–E (foundation, core service, CLI, VS Code) **done**. Tracks F–H (web app + shell) gated. **ADRs 0001–0005**:
  - 0001: Lit for shared UI (accepted)
  - 0002: opt-in `trace?: (event) => void` matcher hook (accepted)
  - 0003: live grammar snapshot transport (deferred)
  - 0004: Monaco/LSP over WebSocket for web app (deferred)
  - 0005: shared service contract (deferred)
- **`docs/design/workflowSystem/`** — v1 IR adopted. Principles P1–P5 (static type provability, traceable data flow, structural correspondence, independent testability, predictability). IR is **compile target**, not a human authoring surface.
- `CONFIGURATION_AND_PERSISTENCE.md` — dual cache, automatic cache population, file discovery order.

### Dev loop

- **Build**: `fluid-build` orchestrates, `tsc -b` per package, plus `asc` / `agc` for agents. Incremental. `pnpm run build <pkgRegex>` for targeted builds.
- **Test**: `*.spec.ts` (unit, `test:local`) vs `*.test.ts` (live, `test:live`). Jest from `dist/test/`. 90s global timeout. Live tests concurrency=1 (API quotas). Per-package `pnpm run jest-esm --testPathPattern=...`.
- **Format/lint**: `pnpm run prettier(:fix)`, `pnpm run check:policy` (MIT header), `pnpm run check:dep`, `pnpm run check:link`, `pnpm run test:keys`.
- **Config precedence (6 locations) for `agentServerConfig.json`**:
  1. `$AGENT_SERVER_CONFIG`
  2. `./agentServerConfig.json`
  3. `./.agentServerConfig.json`
  4. `~/.typeagent/agentServerConfig.json`
  5. `~/.agentServerConfig.json`
  6. `$TYPEAGENT_INSTANCE_DIR/agentServerConfig.json`
- **Env keys**: `ts/.env`. `npm run getKeys [--vault <name>]` populates from Azure Key Vault. `npm run test:keys` validates structure.
- **Runtime knobs**: `@config cache.grammarSystem nfa|completionBased`, `@config agent <name> on|off`.

### Deployment artifacts

- Shell: Electron installers (`.dmg` / `.exe`) via `pnpm run shell:package`.
- VS Code extensions: vsce packaged. `pnpm run deploy:local` per extension (no batch script).
- Agent server: Node daemon, PID file at `~/.typeagent/server-<port>.pid`.
- MCP server: in `packages/commandExecutor`.

---

## 7. Inventory of capabilities that need a home in the VS Code experience

Brain-dump of every capability discovered, mapped to the natural surface where it belongs. This is _not_ the feature plan — it is raw material for Phase 3.

| Capability                                                            | Source                                                      | Likely VS Code surface                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `.agr` syntax highlighting                                            | `agr-language`                                              | Language extension (exists)                 |
| `.agr` LSP (diagnostics, defs, refs, hover, format, symbols)          | `grammarTools/core` + `agr-language`                        | Language extension (exists)                 |
| `.agr` debug panel (trace, coverage, completion preview, diff)        | `grammarTools/ui` + `agr-language`                          | Webview (exists, partial)                   |
| `.ts` schema validation / lints                                       | `actionSchema`                                              | Language feature on TS files (new)          |
| `.pas.json` / `.ag.json` viewers                                      | actionSchemaCompiler / actionGrammarCompiler                | Custom editors (new)                        |
| Generate `.agr` from `.pas.json` (LLM)                                | `actionGrammar/generation`, `SchemaToGrammarGenerator`      | Command (new)                               |
| Generate phrase variations from schema                                | `schemaAuthor`, `examples/schemaStudio`                     | Command + panel (new)                       |
| Generate schema from external API metadata                            | `examples/vscodeSchemaGen`, onboarding agent                | Wizard (new)                                |
| Scaffold new agent                                                    | `packages/agents/onboarding`                                | Command / TreeView "New Agent" (new)        |
| Agent health check (manifest↔schema↔grammar↔handler↔registration) | none today — needs to be built                              | Diagnostic provider (new)                   |
| Chat with dispatcher                                                  | `vscode-shell` + `chat-ui` + `completionUI`                 | Sidebar + panels (exists)                   |
| Conversation management                                               | `agentServer` + `vscode-shell`                              | Sidebar list (partial)                      |
| Cache inspector (construction + grammar)                              | `cacheExplorer`, `examples/cacheRESTEndpoint`, `cache` APIs | Webview (new, fold in existing UI)          |
| Knowledge / memory inspector                                          | `knowPro`, `memory`, `knowledgeVisualizer`                  | Webview (new)                               |
| Telemetry timeline / event log                                        | `telemetry`, `examples/commandHistogram`                    | Webview + OutputChannel (new)               |
| AI endpoint pool status                                               | `aiclient`                                                  | Status bar item + panel (new)               |
| Workflow capture / edit                                               | `agent-flows`                                               | Custom editor + record button (new)         |
| Demo record / replay                                                  | `vscode-shell` demo commands + shell demo features          | Codelens / playback panel (extend existing) |
| Action routing into VS Code commands                                  | `coda` (stub)                                               | Action handlers (extend existing)           |
| Settings UI for `agentServerConfig.json` / `user-settings.json`       | none — only `@config` text command                          | Webview (new)                               |
| Agent enable/disable                                                  | `@config agent <name> on/off`                               | Sidebar toggle (new)                        |
| Agent readiness + setup flows                                         | `AppAgent.checkReadiness`/`setup`                           | Status indicators + setup card (new)        |
| MCP server bridge                                                     | `packages/commandExecutor`                                  | Config + status (new)                       |
| Coverage corpus runner                                                | `grammarTools/core.computeCoverage`                         | Command + decoration (in plan)              |
| Grammar diff                                                          | `grammarTools/core.diffGrammars`                            | Command + view (in plan)                    |
| Trace match step-through                                              | `actionGrammar` trace hook (ADR 0002)                       | Webview (in plan)                           |

---

## 8. Open questions surfaced during inventory

These are the unresolved decisions that Phase 2/3 will need to resolve.

1. **One extension or many?** `agr-language`, `vscode-shell`, `coda` exist as separate VS Code extensions today. Unified into one (with subcomponents), or kept as a coordinated suite under a single brand/activity-bar container?
2. **Embedded dispatcher vs. always-remote agent-server?** Affects how easily a user can "just try it" without running a daemon.
3. **Where does `examples/schemaStudio` functionality live?** Folded into a "Schema & Grammar Workbench" view? Or kept as a CLI plus thin VS Code surface?
4. **Coda's future:** finish the stub command handlers, merge into vscode-shell, or replace with chat-participant + actions API?
5. **Workflow authoring story:** does VS Code edit `.flow.json` / TaskFlow / WebFlow / PowerShell artifacts, or only invoke the existing capture mechanisms?
6. **Telemetry surface scope:** local dev only (debug logs), or also connect to Cosmos/Mongo backends for analysis?
7. **Where does the "New Agent" wizard run?** As a VS Code command (templates-only) or by invoking the `onboarding` agent (LLM-powered)?
8. **MCP exposure:** should the VS Code extension also be an MCP host/server so other LLM tools can interact with TypeAgent through it?
9. **Schema language services:** treat `.ts` schemas as ordinary TypeScript (with custom diagnostics layered on), or build a dedicated DSL/LSP for them?
10. **Standalone vs. workspace mode:** developer iterating on their own agent in a fresh workspace vs. cloning the TypeAgent monorepo — both need to work, but the UX differs.

---

## 9. Where to look next (pointers for Phase 2)

- **`docs/plans/grammar-tools/PLAN.md`** — the existing multi-phase plan; our roadmap must align with its Tracks F–H.
- **`packages/agents/onboarding/`** — the LLM-driven agent scaffolder; the engine of a future "New Agent" wizard.
- **`extensions/agr-language/`** — architectural template (LSP + Vite webview + Lit components) for any new dev-tooling extension surface.
- **`examples/schemaStudio`** — capability catalog for the "Schema/Grammar Workbench" view.
- **`packages/cacheExplorer` + `examples/cacheRESTEndpoint`** — starting point for a Cache Inspector webview.
- **`packages/telemetry` + `examples/commandHistogram`** — starting point for a Telemetry view.
- **`docs/design/workflowSystem/ir/ir-v1.md`** — must read before designing any workflow-editing UI.

---

## 10. In-flight: Action Collision Detection & Analysis (branch `dev/robgruen/action_collision`)

> Source docs: [`docs/architecture/collision-analysis.md`](../architecture/collision-analysis.md) (user guide for tooling) and [`docs/architecture/collision-rollout.md`](../architecture/collision-rollout.md) (experiment / soft-rollout plan).

This is a substantial, near-landing body of work. It must be treated as a first-class concern in the VS Code dev-experience plan — comparable in scope to grammar-tools.

### 10.1 What problem it solves

TypeAgent has to route a natural-language utterance to one of N typed actions. When two agents (or two sibling actions in one agent) both plausibly match, the dispatcher needs a policy. Empirical baseline: of 1,856 misrouted phrases out of a 4,258-phrase LLM-generated corpus, ~30% are structurally lost (right schema not in the embedding ranker's top-K), ~34% are tunable inside `llmSelect`, ~35% are likely-benign same-schema cases the LLM rescues. The system makes those collisions **visible, measurable, and tunable**.

### 10.2 Three layers

| Layer                     | Purpose                                                                                  | Surface                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Detection** (runtime)   | Catch collisions at four runtime points: `static`, `grammarMatch`, `llmSelect`, `fuzzy`  | `@config collision <point> [detect\|strategy] <value>`, `@collision events`                                    |
| **Measurement** (offline) | Generate phrase corpora, replay through embedding ranker and/or LLM translator, classify | `@collision corpus generate / probe / translate / reanalyze / recovery / visualize / visualize-recovery / run` |
| **Analysis** (offline)    | Cluster confusable actions; preview "neighborhoods" with policy in mind                  | `@collision similar`, `@collision probe`, `@collision neighborhoods preview`                                   |

### 10.3 Resolution strategies (when a collision is detected)

- `first-match` (default, byte-identical to legacy)
- `score-rank` (deterministic re-ranking using existing match metadata)
- `priority` (operator-supplied agent priority order)
- `user-clarify` (synthesize a clarification action; visible UX)
- `warn` (telemetry only, no behavior change)

### 10.4 Three signals that feed the analysis layer

|                                 | **Similarity**                                 | **Embedding probe** (S2/S3)                   | **Translation probe** (S4)                                                                       |
| ------------------------------- | ---------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| What it observes                | Embedding distance between action descriptions | Embedding ranker's top-K for an actual phrase | LLM translator's chosen (schema, action) for a phrase                                            |
| Phrases needed?                 | No                                             | Yes                                           | Yes                                                                                              |
| Closest to runtime ground truth | Lowest                                         | Middle                                        | Highest                                                                                          |
| Cost                            | Embedding API only                             | ~1× embedding per phrase                      | ~10× embedding per phrase                                                                        |
| Catches                         | Semantic neighbors regardless of grammar       | Phrases the ranker drops the right schema for | Phrases the ranker would surface fine but translator picks wrong; same-schema sibling confusions |

The `@collision similar` tool runs a six-vector cosine analysis (`desc`, `params`, `nameShape`, `agentContext`, `agentAndAction`, `combined`) with strategies named `balanced`, `desc`, `params`, `nameShape`, `agentContext`, `agentAndAction`, and clusters via complete-linkage agglomeration.

### 10.5 Visualizations (self-contained HTML, D3 from CDN)

All three land under `<instanceDir>/collisions/`.

1. **`collisions-viz.html`** — misroute hotspot map: schema×schema heatmap, top-N action sankey (expected → actual), filterable misroute edge table with sample phrases on expand.
2. **`recovery-viz.html`** — runtime-aware bucket analysis: stacked headline bar (same-schema benign / cross in-cluster `llmSelect`-tunable / cross out-of-cluster widen-threshold / cross off-list structural), per-action profile, action-rank histogram, click-to-filter, click-row-to-expand-phrases.
3. **`neighborhoods-preview.html`** — ambiguity neighborhoods: filterable list with kind/source/size badges, members ranked by gravity (`owed`, `stolen`, `partners`, `entangle`, `weighted`, `share`), confirm-threshold slider for live retagging, hierarchical edge-bundling chart (radial, `agent → schema → action`).

### 10.6 New / extended packages and files (where it lives)

- **`packages/grammarTools/core`** — `nfaIntersection.ts`, `collisionScanner.ts` (NFA-product static scanner with concrete witness phrases).
- **`packages/grammarTools/cli`** — `analyzeCollisions.ts`, `cli.ts` (standalone `grammar-tools collisions` / `analyze-grammar-collisions`).
- **`packages/actionGrammar`** — `@grammar collisions [--json <path>]` command; extended index/test.
- **`packages/dispatcher/dispatcher/src/translation/`** — `actionSimilarity.ts`, `fuzzyCollision.ts`, `matchCollision.ts` (runtime detection points).
- **`packages/dispatcher/dispatcher/src/context/`** — `collisionTelemetry.ts` (`CollisionEvent` type, ring buffer, JSONL append, logger hook), `system/handlers/collisionCommandHandlers.ts`, `collisionCorpusHandlers.ts`, `collisionNeighborhoodHandlers.ts`.
- **`packages/defaultAgentProvider/src/collisions/`** — `probeRunner.ts`, `translationRunner.ts`, `translationCompareRunner.ts`, `translationDiffViz.ts`, `expandedCorpusRunner.ts`, `previewRunner.ts`, `listModels.ts`, `silentClientIO.ts`, `smokeTest.ts`.
- **`docs/architecture/`** — `collision-analysis.md`, `collision-rollout.md`.
- **`packages/agents/vampire/`** — new test agent used for deliberate collisions.
- **`packages/copilot-plugin/skills/typeagent-setup/SKILL.md`** — new onboarding skill, mentions collision tooling.

### 10.7 Telemetry surface (significant)

- `CollisionEvent` shape (after M2 enrichment) includes: `kind` (which detection point), `strategy`, `candidates[]` with heuristic counters (`matchedCount`, `nonOptionalCount`, `wildcardCharCount`, `priorityRank`), `chosen`, `firstMatchCandidate` (what legacy would have picked), `classifier` (for `grammarMatch`), `elapsedMs`, `request`, `note`, `timestamp`, `requestId`, `experimentId`, `sessionId`.
- Per-session JSONL: `~/.typeagent/profiles/<profile>/sessions/<name>/collision-events.jsonl` (always-on local record when `collision.telemetry.emit` is on).
- Cosmos `dispatcherlogs` collection: events flow via `logger.logEvent("collision", ...)` when `@config log db on` AND `collision.telemetry.emit`.
- `@collision events [-n N] [-k <kind>]` — read recent events from JSONL or ring buffer, with `⚡` marker on divergences from `first-match`.

### 10.8 On-disk artifacts (where to look during debugging)

- `<instanceDir>/collisions/` — workdir for all corpus pipeline artifacts: `corpus.json`, `probe-results.json`, `probe-results-reclassified.json`, `translation-results.json`, `collisions-viz.html`, `recovery-viz.html`, `neighborhoods-preview.html`.
- `<instanceDir>/agentCache/actionSimilarity/embeddings.json` — content-hashed embedding cache for similarity scans.
- `~/.typeagent/profiles/<profile>/sessions/<name>/data.json` → `settings.collision` — per-detection-point config (detect on/off, strategy, telemetry.emit, telemetry.experimentId, priorityOrder, fuzzy.staticEnabled, fuzzy.runtimeEnabled, fuzzy.scorer).

### 10.9 Phase status (from `collision-rollout.md` as of 2026-05-08)

| Phase           | Scope                                                                                     | Status                                                      |
| --------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Tooling M1–M5   | `@config collision`, enriched event shape, logger hook, JSONL append, `@collision events` | Mostly landed                                               |
| Phase 1 (E1.x)  | Observability with `first-match` strategy on each detection point                         | Planned, gated on M1–M5                                     |
| Phase 2 (E2.x)  | Strategy A/B: `score-rank`, `priority`, `user-clarify` per detection point                | Planned                                                     |
| Phase 3 (F1–F5) | Fuzzy detection: real scorer, runtime hook, threshold calibration, matrix cache           | Blocked on S1                                               |
| Phase 4 (T1–T4) | Static NFA collision triage, `.agr` tuning, CI gate                                       | Independent parallel track                                  |
| Phase 5 (S1–S4) | Semantic similarity, corpus pipeline, embedding probe, translation probe                  | S1, S2, S3 done; S1b and translation-probe wiring remaining |

### 10.10 Implications for the VS Code dev experience

This work materially changes the inventory in §0 and §7. Concretely:

1. **A new top-level concern for the VS Code plan**: "schema analysis & dispatch quality" (sits between schema/grammar authoring and runtime observation). Probably its own activity-bar view or webview category.
2. **Three HTML reports are already first-class developer artifacts** — likely candidates for either: (a) hosting them as VS Code webviews via "Open Latest Collision Report" command, or (b) re-implementing the same visualizations as native webviews driven by the same JSON data (consistent with the Lit / grammar-tools-ui pattern from ADR 0001).
3. **`@collision` and `@grammar collisions` are command-driven today.** A VS Code surface for "run corpus / open hotspots / open neighborhoods / preview neighborhoods" is a small but high-leverage wrapper. Same template as `agr.openDebugPanel` etc.
4. **A new telemetry channel exists**: collision events. The Telemetry view in any future VS Code surface must include collision events as a category, with filters by `kind`, `strategy`, `experimentId`, `sessionId`.
5. **`@config collision <point> [detect|strategy] <value>`** is config that screams for a Settings panel — toggles per detection point, strategy dropdowns, priority-order editor. Same surface should handle `@config log db on/off` and `@config cache.grammarSystem`.
6. **The NFA collision scanner produces concrete witness phrases.** These can drive a **CodeLens / inline annotation** on `.agr` files: "this rule collides with `<agent>.<action>` on phrase `foo bar`." A natural extension of the existing `agr-language` LSP.
7. **The neighborhoods preview is policy-shaping material**, not just a debug view. Long-term, the VS Code experience should support "promote a previewed neighborhood into a persisted policy" (Phase 1+ of the neighborhoods rollout in `collision-rollout.md`). Worth noting in Phase 3 features even if Phase 1/2 just surface the preview.
8. **The collision system shares dependencies with grammar-tools**: `nfaIntersection.ts` and `collisionScanner.ts` live in `grammarTools/core`. Any VS Code integration of grammar-tools must include the collision scanner surface from day one.
9. **Embedding & corpus runs are expensive (~12 min for full corpus, ~25 min for multi-model corpus generation).** UX must support: "resume from step" (the `--from` flag), background/cancellable runs, cached results, and clear "this is going to cost N API calls" warnings. Treat them like long-running CI tasks, not interactive commands.
10. **Open question to add to §8**: should collision detection / corpus / neighborhood-preview be a _separate_ VS Code surface ("Schema Quality") or fused into the same workbench as schema/grammar authoring? Likely the latter, but the activity-bar shape changes if so.

### 10.11 Capabilities to add to §7 inventory table

| Capability                                         | Source                                                                                      | Likely VS Code surface                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Static NFA collision scan with witness phrases     | `grammarTools/core/{nfaIntersection,collisionScanner}.ts`, `@grammar collisions`            | CodeLens / Problems panel entries on `.agr` files; "Scan All Grammars" command |
| Multi-vector action similarity scan + clustering   | `dispatcher/translation/actionSimilarity.ts`, `@collision similar`                          | Webview ("Action Similarity") with strategy picker + cluster view              |
| Single-phrase embedding probe                      | `@collision probe`                                                                          | Inline panel in chat / webview ("What would the ranker pick?")                 |
| LLM phrase corpus generation (multi-model, styled) | `defaultAgentProvider/src/collisions/expandedCorpusRunner.ts`, `@collision corpus generate` | Long-running task with progress + cost preview                                 |
| Embedding probe replay over corpus                 | `defaultAgentProvider/src/collisions/probeRunner.ts`, `@collision corpus probe`             | Long-running task                                                              |
| LLM translation probe replay over corpus           | `defaultAgentProvider/src/collisions/translationRunner.ts`, `@collision corpus translate`   | Long-running task; expensive                                                   |
| Collision hotspots viz                             | `collisions-viz.html` (HTML output)                                                         | Open in VS Code webview; or native re-impl with Lit                            |
| Recovery breakdown viz                             | `recovery-viz.html`                                                                         | Open in VS Code webview                                                        |
| Neighborhoods preview viz                          | `neighborhoods-preview.html`                                                                | Open in VS Code webview; future: promote to persisted policy                   |
| Runtime collision detection toggles                | `@config collision <point> [detect\|strategy]`                                              | Settings webview / sidebar toggles                                             |
| Collision event telemetry stream                   | `collisionTelemetry.ts`, JSONL + Cosmos                                                     | Telemetry view with kind/strategy/experimentId filters                         |
| Experiment tagging                                 | `experimentId` in event shape, `collision.telemetry.experimentId` config                    | Status bar with current `experimentId`; "Start Experiment" command             |
| Per-agent priority-order editor                    | `priorityOrder` in collision config                                                         | Form field in Settings webview                                                 |

---

## 11. Conversational agent authoring (MCP + onboarding)

> Triggered by the observation that "create an agent for X" already works from Claude/Copilot via MCP. The VS Code dev experience should treat _natural-language agent authoring_ as a primary path, not a secondary one.

### 11.1 What already exists

- **`packages/agents/onboarding/`** — multi-phase LLM-driven agent that scaffolds other agents end-to-end. Phases: Discovery (crawl docs / parse OpenAPI) → PhraseGen → SchemaGen → GrammarGen → Scaffolder → Testing → Packaging. Implements the `state-machine` pattern from agent-patterns.md (uses `handleChoice` for approvals between phases).
- **`packages/agents/onboarding/src/scaffolder/cliHandlerTemplate.ts`** — string template for CLI-wrapper agents; produces full package layout.
- **`packages/copilot-plugin/`** — two modes:
  - **Direct mode**: Copilot CLI hooks (`userPromptSubmitted`, `agentStop`, `preToolUse`, `postToolUse`) forward action-like prompts to TypeAgent over WebSocket; questions fall through to Copilot's LLM.
  - **MCP mode**: TypeAgent is exposed as MCP tools (`typeagent-processCommand` + progress notifications). Claude or Copilot's MCP client calls in.
- **`packages/commandExecutor/`** — also an MCP server exposing `typeagent_action`.
- **`packages/mcp/`** — MCP client infrastructure (the dispatcher can also _consume_ MCP servers, treating them as agents via `mcpDefaultAgentProvider`).

Net effect today: a developer can already type "create an agent that does X" into Claude or Copilot and the onboarding agent runs. **What's missing is the integrated experience** — the developer has to leave VS Code to a separate Claude/Copilot session, then return to their workspace to find the generated files.

### 11.2 Design implications for the VS Code experience

1. **The "New Agent" surface is a chat conversation, not a form.**
   The primary entry point should be: a chat (vscode-shell sidebar, Copilot Chat participant, or both) where the developer says "I want an agent that talks to the OpenWeather API." The onboarding agent runs, with approval gates rendered as inline choice cards (the existing `handleChoice` mechanism already supports this — see calendar's OAuth flow as a model).

2. **A form-based scaffolder still has a role**, but as the "I already know what I want" fallback for power users (pick pattern, name, target folder → stamp files). It should produce the _same_ artifact shape as the conversational path so users can switch between modes.

3. **Three plausible chat surfaces — likely all three coexist.**

   - **Native chat participant (`@typeagent` in Copilot Chat)** — uses VS Code's Chat API (`vscode.chat`). Best for "ambient" use; works from any open chat. Requires routing decisions: should `@typeagent` proxy to the dispatcher, or expose only a curated subset of commands?
   - **vscode-shell sidebar / panel** — already exists; gives full dispatcher access (every agent, full conversation history, dynamic displays, choice cards). Best for "I'm working on agents right now" deep work.
   - **External Claude / Copilot via MCP** — already works; no VS Code-specific code needed. Best for users who live in another LLM host.

4. **Output integration matters as much as input.**
   When the onboarding agent finishes, the result is a folder of generated files. The VS Code experience should:

   - Auto-create / open the workspace folder for the new agent.
   - Run `pnpm i` and `pnpm run build` automatically (with progress in the terminal output channel).
   - Run the **Agent Health Check** diagnostic (from §0 observation 9) immediately.
   - Offer a "Try it" command that opens chat pre-focused on the new agent.
   - Surface the generated `.ts` schema + `.agr` grammar in editors with `grammar-tools` debug panel already pointed at the file.

5. **MCP host vs MCP server is not exclusive — be both.**

   - **As MCP server**: keep what works. External Claude/Copilot continues to invoke TypeAgent. The Copilot Chat participant inside VS Code can route through the same MCP surface for consistency.
   - **As MCP host**: the dispatcher already does this via `mcpDefaultAgentProvider`. The VS Code surface should expose a "Connect MCP server…" UX so a developer can plug a new MCP server into their TypeAgent without editing JSON.

6. **The onboarding agent is the seed of much more.**
   "Create an agent for X" is just one entry point. Same machinery should drive:

   - "Add a new action to my existing agent" (incremental schema + grammar update).
   - "Generate phrase variations for this action" (PhraseGen alone — already exists in schemaStudio).
   - "Diagnose why this grammar doesn't match this utterance" (a conversational front-end for `@collision probe` + `agr.traceMatch`).
   - "Run the corpus pipeline against my agent and explain the misroutes" (chat-driven wrapper around `@collision corpus run` + the resulting reports).

7. **Hand-off between conversation and tools must be bidirectional.**
   A pure-chat experience hides what's happening. The flow should be:
   - Chat suggests / proposes an action → developer can **inspect** what files would be created before approving.
   - Tool output (a generated `.agr`, a misroute report) can be **discussed in chat** — selecting text or a diagnostic and "ask TypeAgent about this" should drop the developer back into a conversation with the relevant context attached.
     This is the same pattern as Copilot's "ask about selection" but applied to TypeAgent-domain artifacts.

### 11.3 Capabilities to add to §7 inventory table

| Capability                                                         | Source                                                                         | Likely VS Code surface                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Conversational "create an agent for X"                             | `packages/agents/onboarding`, MCP server in `commandExecutor`/`copilot-plugin` | Chat participant + sidebar chat; choice cards for approvals    |
| "Add an action to existing agent"                                  | onboarding incremental mode (does not exist yet)                               | Chat command + CodeAction on schema files                      |
| MCP server discovery & registration UI                             | `packages/mcp`, `mcpDefaultAgentProvider`                                      | "Connect MCP Server…" command + Settings panel                 |
| MCP host integration (consume external MCP)                        | `packages/mcp`                                                                 | Already works programmatically; needs UI                       |
| Post-generation auto-setup (install, build, health check, open)    | none today — needs to be built                                                 | Composite command run after onboarding completes               |
| Selection / diagnostic → chat handoff ("ask TypeAgent about this") | none today                                                                     | CodeAction / context menu on `.agr` / `.ts` / collision report |

### 11.4 Updates to the open questions in §8

Question **#7** ("Where does the New Agent wizard run? As a VS Code command (templates-only) or by invoking the onboarding agent?") should be **resolved as "both, with conversation primary"**:

- Primary path: chat-driven invocation of the onboarding agent (LLM-powered, end-to-end).
- Secondary path: form-based command for power users who don't need LLM scaffolding.
- The two paths produce identical artifact shapes.

Question **#8** ("MCP exposure: should the VS Code extension be an MCP host/server?") should be **resolved as "be both"**:

- Remain an MCP server so external Claude/Copilot continue to work unchanged.
- Become an MCP host so the in-VS-Code experience can consume external MCP servers as agents.
- Add UI for both registrations.

A **new open question** to add to §8:

- **#11. Chat surface allocation.** When a developer is in VS Code, do `@typeagent` in Copilot Chat, the vscode-shell sidebar, and the vscode-shell panels all do the same thing, or do they specialize? If they share state (same conversation), how? If they don't, how does the developer know which to use?

---

## 12. User feedback corpus (PR #2341, merged 2026-05-14)

**Source:** `dev/robgruen/user_feedback` → `main`, +3409 / −22 lines. Title: "Implement feedback mechanism and add it to the UI."

### What it adds

A first-class human-labeled quality signal attached to specific agent responses. Three layers:

1. **UI (chat-ui package + shell renderer).**

   - Per-bubble action row with 👍 / 👎 / copy / ⋯ ; thumbs-down opens a popover collecting an optional category (`wrong-agent | didnt-understand | bad-response | other`), free-text comment, and an opt-in "share my prompt and the response" checkbox.
   - Trash icon on each bubble (user-side and agent-side toggle **independently** \u2014 the user can hide their request without hiding the response or vice-versa).
   - Two implementations: `packages/chat-ui/src/feedbackWidget.ts` (528 lines) and a parallel `packages/shell/src/renderer/src/feedbackWidget.ts` (554 lines). Styles in `chat.css` and `styles.less` are kept in sync by convention. Restored on saved-history bubbles via `ChatView.rewireHistoricalFeedback()`.

2. **Plumbing.**

   - **Dispatcher RPC additions** (`recordUserFeedback`, `recordUserHide`, `restoreAllHidden`, `flushHidden`) on the existing `Dispatcher` interface.
   - **ClientIO broadcast** (`onUserFeedback(entry)` / `onUserHide(entry)`) fans rating changes out to every connected client; the dispatcher uses the broadcast for its own local UI update too.
   - **Append-only displayLog persistence**: new entry variants `user-feedback` and `user-message-hidden` join the existing `DisplayLogEntry` union. Reduced last-wins per `requestId` (per-`(requestId, target)` for hides).
   - **Telemetry hook**: `context.logger?.logEvent("userFeedback", payload)` fires on every rating; with `includeContext: true`, the payload also carries `{prompt, responses[], actions[]}` reconstructed via `gatherFeedbackContext()` from the same displayLog.
   - **`dblogging` default flipped to `true`** \u2014 every dev session now emits `userFeedback` events to Cosmos/Mongo by default.

3. **Retrieval / export commands.**
   - `@feedback list [--limit N] [--all]` \u2014 newest-first, latest-rating-per-request unless `--all`.
   - `@feedback top [--limit N]` \u2014 totals by rating plus top thumbs-down categories.
   - `@feedback filter [--rating up|down|cleared] [--category ...] [--since ...] [--until ...] [--limit N] [--all]`.
   - `@feedback export <file> [--format json|jsonl] [--all]` \u2014 path with `~` expansion and overwrite prompt; **JSONL is a clean corpus interchange format**.
   - `@feedback count` \u2014 one-line summary.
   - `@shell trash restore` / `@shell trash flush` \u2014 bulk lifecycle for the hide-bin.

### Why this is its own section, not a sub-bullet of §3 telemetry

The three telemetry streams cataloged in §3 are:

- `debug("typeagent:*")` — unstructured stderr text from 180+ call sites.
- `Logger.logEvent()` + sinks (Debug / Cosmos / Mongo) — emit-only, no queryable local store.
- (added in §10) Collision events — structured runtime events, experimentId-tagged.

All three are **machine-generated observations of system behavior**. PR #2341 introduces a fundamentally different _category_: **human judgment about whether a specific response was correct**, tied to a concrete (request, response) pair. That makes it:

- The **only ground-truth signal** in the platform.
- The natural **quality oracle** for any "did this schema/grammar change make things better or worse?" question.
- A **labeled corpus source** in its own right — utterances + responses + labels, ready to be replayed.

### How it composes with everything else in the inventory

- **§3 (telemetry inventory):** add feedback as a fourth event class. Unlike the other three, it has a stable schema by construction (UI form fields) and a built-in retrieval API (`@feedback` commands) — it does not need the "structured event protocol" migration the other streams need.
- **§7 (capabilities → VS Code surfaces) — new rows:**
  - _Per-message rating + free-text feedback_ → chat bubble UI (already exists in chat-ui; vscode-shell chat panel needs to either embed chat-ui or re-implement the footer).
  - _Feedback retrieval (`@feedback get / view / download`)_ → command palette entries + a dedicated panel/tree view in the VS Code experience.
  - _Message visibility management (trash / bubble-hide)_ → chat-ui state, mirrored in vscode-shell if it has its own renderer.
- **§10 (collision detection):** feedback and collision events are complementary. Collision events say "the system noticed two actions competed for this utterance." Feedback says "the user judged the chosen action wrong." Cross-correlating them is high-value: a 👎 on an utterance with a recent collision is much higher-signal than either alone.
- **§11 (conversational agent authoring):** the onboarding agent's `Testing` phase can use feedback from a prior run of the candidate agent as a regression-style oracle ("re-test these previously-👎'd utterances").

### Implications for the VS Code plan

1. **Feedback corpus = labeled source in the federated corpus story.** Whatever federated-corpus design the plan adopts must accept feedback-derived (utterance, response, label, timestamp, sessionId) tuples as a first-class source, alongside in-repo `*.tests.json` and per-user cache captures. Provenance metadata needs a `feedback` source-type.
2. **Impact Report / regression-finding journeys gain a quality dimension.** Instead of only reporting "behavior changed between vA and vB for utterance X," the report can annotate "behavior changed _and the previous version was 👎'd_" (likely improvement) vs "behavior changed _and the previous version was 👍'd_" (likely regression). This is the single biggest leverage feedback gives the dev experience.
3. **Trace-investigator journey gains a worklist.** "Show all 👎 traces this week" becomes a natural entry point for the trace-investigation surface. Today there is no equivalent way to triage which traces to look at.
4. **MVP success metric sharpens.** A compare-and-replay MVP can be evaluated not by "did diffs appear" but by "did the diffs _agree with feedback labels_ when scored against the labeled portion of the corpus."
5. **No new event-protocol work needed for feedback.** Unlike the other three telemetry streams, feedback already has a structured shape, a retrieval API, and a transport (dispatcher RPC + ClientIO). The cross-cutting "structured event protocol" effort should leave feedback alone and instead model itself on feedback's existing shape.

### Open questions for §8 to absorb

- **#12. Feedback storage and persistence.** Where do feedback records actually live on disk (per-profile? per-session? per-agent?), and what is the retention story? `@feedback download` implies serialization to a portable format — is that format stable enough to be a corpus interchange format?
- **#13. Feedback granularity.** Is feedback per-message only, or also per-action-within-a-message (which would tie directly into the action-level diff in the Impact Report)?
- **#14. Privacy / sharing.** Feedback is intrinsically user-authored content. The federated-corpus story has a "redaction-review pass" for capture promotion; does feedback need an equivalent gate before being checked into a shared corpus?

---

## 13. Phase 2 — Open-question resolutions (proposed)

Walks each question accumulated through §8, §11 (Q11), and §12 (Q12–Q14) plus the four open items in the parallel `we-have-a-giant-declarative-platypus.md` plan. Each carries a status tag:

- ✅ **Resolved** — settled by either explicit user decision or unambiguous inventory finding. Adopt as-is.
- 🟡 **Proposed, needs user confirm** — best-supported answer given current evidence; one nod from you locks it in.
- 🔴 **Needs research** — answer requires reading code we haven't read or making a product call we can't make alone.

### §8 questions

**Q1. One extension or many?**
✅ **Resolved (parallel plan):** Brand = **TypeAgent Studio**. Technical = **extension pack of four**: `typeagent-core` (services, no UI), `typeagent-studio` (primary surface), `agr-language` (refactored, depends on core), `vscode-shell` (refactored, depends on core). User flagged a single-extension alternative; the pack recommendation stands unless overridden.

**Q2. Embedded dispatcher vs. always-remote agent-server?**
✅ **Resolved (2026-05-14): hybrid, with isolation as the firm requirement.**
The dev/test dispatcher must be **isolated** from the developer's active personal agent-server (the one running their day-to-day TypeAgent). Approach:

- **Default:** Studio spawns a **sandboxed `agent-server` process** — separate port, separate `~/.typeagent/profiles/<studio-instance>/` profile. Same code path as production, inspectable from CLI/WS tools.
- **Opt-in (via config):** an **in-memory dispatcher** mode where `typeagent-core` instantiates the `Dispatcher` directly inside the VS Code extension host. Lighter, but the dispatcher's heavy deps live in the extension host.
- **Small optimization:** Studio's sandbox **dynamically loads/unloads agents** rather than registering all of them on every dev session. Reduces memory + startup cost and keeps the test environment focused on the agent under iteration.
- **Never:** reuse the developer's active personal agent-server. Conflating those would mean Studio's tuning experiments would leak into the developer's everyday usage.

**Q3. Where does `examples/schemaStudio` live?**
✅ **Resolved (parallel plan):** Graduate into the **Schema Studio webview** in `typeagent-studio`. The CLI commands (`@fromSchema`, `@variations`, `@mergeCaches`) stay in `examples/schemaStudio` as automation primitives, deprecated as user-facing tools (per the parallel plan's "Retirements" section).

**Q4. Coda's future?**
✅ **Resolved (parallel plan):** **Archive `packages/coda`** — dead, stubs only, different publisher, superseded by `vscode-shell`.

**Q5. Workflow authoring story?**
✅ **Resolved (2026-05-14): partial — view-only in MVP, editing later.** Studio renders / inspects existing `.flow.json`, TaskFlow, WebFlow, and PowerShell artifacts (read-only) in MVP so they're discoverable alongside agents. Editing UI is a post-MVP vertical; MVP still uses the existing capture mechanisms unchanged for any new workflow.

**Q6. Telemetry surface scope?**
✅ **Resolved (2026-05-14): include remote-sink read access in MVP.** Studio reads (a) the structured event stream over WS, (b) on-disk session/cache/displayLog state, (c) feedback records, **and (d) the Cosmos/Mongo sinks for cross-session / cross-developer analysis.** Justified now because `dblogging` is on by default (per Q12 finding) so feedback + standard events are already accumulating in Cosmos for every dev — the analysis UI is what makes that data useful. Pair with a visible "remote logging on" indicator + an easy local-only toggle for sensitive corpora.

**Q7. "New Agent" wizard run mode?**
✅ **Resolved (already in §11):** Both, conversation primary. Chat-driven invocation of the `onboarding` agent is the primary path; a form-based command palette entry is the secondary path; both produce identical artifact shapes.

**Q8. MCP exposure?**
✅ **Resolved (2026-05-14): server side already done; defer the host role.** Per the parallel plan, **individual agents do not expose MCP**. TypeAgent-as-a-whole already exposes MCP via `packages/commandExecutor` (`typeagent_action`) and `packages/copilot-plugin` — unchanged. Studio becoming an **MCP host** (consuming external MCP servers from inside VS Code as agents) is **deferred past MVP**; Copilot Chat already plays that role in the same editor. **Corrects the earlier "be both" wording in §11.**

**Q9. Schema language services?**
✅ **Resolved (2026-05-14): layer on top of ordinary TypeScript; no new LSP.** Add (a) custom diagnostics from the `actionSchema` parser, (b) code lens for corpus coverage ("matched by N corpus utterances; M unmatched"), (c) cross-link to AGR rules. No DSL. `agr-language` stays the only language-service extension in the pack.

**Q10. Standalone vs. workspace mode?**
✅ **Resolved (2026-05-14): any workspace; monorepo auto-discovery is a special case.** Studio works in any workspace. `.typeagent/studio.json` declares corpus sources. When the TypeAgent monorepo is open, Studio auto-discovers in-repo corpora. The extension does **not** require the monorepo to be open.

### §11 question

**Q11. Chat surface allocation (Copilot Chat `@typeagent` vs `vscode-shell` sidebar vs panels)?**
✅ **Resolved (2026-05-14): shared session state via `typeagent-core`; differentiated UX.**

- `typeagent-core` owns the live session (id, conversation history, dispatcher connection).
- **Copilot Chat `@typeagent`** = inline conversational entrypoint (good for "create an agent for X", quick tuning).
- **`vscode-shell` sidebar / panels** = rich UI (visualizations, attachments, trace-linked replies); the place for compare-and-replay.
- Both target the same dispatcher; both can pick up the other's conversation by sessionId.

Note: Studio's chat surfaces target the **sandboxed dispatcher from Q2**, not the developer's personal agent-server. If a developer wants to use TypeAgent normally in the same editor, that runs against a separate agent-server connection.

### §12 questions (feedback corpus)

**Q12. Feedback storage and persistence.**
✅ **Resolved (from PR #2341 source).**

- **Where:** appended to the **per-session `displayLog.json`** (not a separate file) as new entry variants `user-feedback` and `user-message-hidden` on the existing `DisplayLogEntry` union. Append-only with `seq` + `timestamp`; last entry per `requestId` wins (helpers: `reduceToLatest` / `getCurrentFeedback`).
- **Also:** every rating event fires `context.logger?.logEvent("userFeedback", payload)` — so it flows into the existing `Logger`/`MultiSinkLogger` and lands in any registered Cosmos/Mongo sinks. **The PR flipped `dblogging` default to `true`** in `commandHandlerContext.ts` and `agentServer/server.ts` — every dev now produces a Cosmos/Mongo `userFeedback` event by default.
- **Optional context bundle:** the chat-ui popover has an opt-in "share my prompt and the response" checkbox. When set, the dispatcher's `gatherFeedbackContext()` replays the displayLog for that `requestId` and attaches `{prompt, responses[], actions[]}` to the telemetry payload — capturing exactly the action JSONs the user saw. This is the bridge from per-message rating to action-aware analysis.
- **Retention:** implicit — lives as long as the per-session `displayLog.json` does.
- **Export:** `@feedback export <file> [--format json|jsonl] [--all]` with `~` expansion and overwrite-prompt; the JSONL form is a clean **corpus interchange format** out of the box. `--all` includes the full append history (re-rates).

**Q13. Feedback granularity (per-message vs per-action).**
✅ **Resolved (from PR #2341 source).**

- **Rating itself = per-`requestId`.** A `UserFeedbackEntry` carries `{requestId, rating: "up"|"down"|null, category?, comment?}`. Categories provide a coarse per-👎 typology: `wrong-agent | didnt-understand | bad-response | other`.
- **Per-action data is reachable via the opt-in context bundle.** When `includeContext: true`, the telemetry event payload carries `context.actions[]` (the action JSON the user saw for that request), which lets a downstream Impact Report annotate **at action granularity** — "the 👎 corresponded to action X with arguments Y." Without `includeContext`, granularity is the request only.
- **Trash is a separate concept and is sub-message.** `UserMessageHiddenEntry` carries `{requestId, hidden, target?: "user"|"agent", permanent?}` — the user can hide their own bubble independently of the agent reply (or vice-versa) via the in-bubble trash icon. The dispatcher exposes `recordUserHide`, `restoreAllHidden`, `flushHidden` and emits `clientIO.onUserHide` broadcasts.
- **Implication for the Impact Report:** request-level rating is the primary signal; the action-level annotation is only available when the user opted in at rating time. The federated-corpus design should treat `context.actions[]` as a first-class structured field on labeled corpus entries when present, and degrade gracefully when absent.

**Q14. Privacy / redaction gate for shared feedback.**
✅ **Resolved (2026-05-14): no separate gate.** Feedback rides the same channels as everything else — already going to Cosmos/Mongo when `dblogging` is on, exportable via `@feedback export`. The federated-corpus design's promotion step still applies to _checked-in_ corpora, but feedback itself does not need a stricter review gate. Developers are responsible for their own opt-in to context sharing at rating time (the chat-ui popover's "share my prompt and the response" checkbox).

### Parallel plan's open items (`we-have-a-giant-declarative-platypus.md`)

**Q-P1. Studio = pack or single extension?**
✅ **Same as Q1.** Pack stands unless overridden.

**Q-P2. Onboarding wizard UI: linear, or revisitable panels?**
✅ **Resolved (2026-05-14): revisitable panels with a "guided" default.** The seven phases (Discovery → PhraseGen → SchemaGen → GrammarGen → Scaffolder → Testing → Packaging) are intrinsically iterative — phase 5 surfaces gaps that send you back to phase 3. Each phase is its own panel in Studio's New Agent surface, with a "guided" toggle that walks them in order for first-timers but lets power users jump.

**Q-P3. Marketplace timeline.**
🔴 **Product call.** Affects how much API stability + docs investment lands in MVP. Recommendation: budget for "internal-only, marketplace-publishable shape" — i.e., we don't publish in MVP, but every API and contribution we add is shaped as if we will. This is cheap if done from day one and prohibitive to retrofit.

**Q-P4. MVP anchor agent.**
✅ **Resolved (2026-05-14): `player`.** Neither `code` nor `list`. The `player` agent has a well-shaped action surface (music control, queue management, playback state) that's expressive enough to demo non-trivial schema/grammar tuning while being easier to mentally model than `code`'s 684-utterance VS-Code-command surface. **Implication:** the MVP needs a corpus for `player` — building one is part of the MVP work, and exercises the federated-corpus capture path end-to-end. `code`'s existing 684-utterance corpus becomes the **second-agent validation** target, proving the federated-corpus design handles a larger, externally-sourced corpus.

### Summary

| Status                           | Count | Questions                                                                     |
| -------------------------------- | ----- | ----------------------------------------------------------------------------- |
| ✅ Resolved                      | 16    | Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14, Q-P1, Q-P2, Q-P4 |
| 🔴 Needs research / product call | 1     | Q-P3                                                                          |

Phase 2 (open-question resolution) is **effectively closed** as of 2026-05-14. The remaining 🔴 item is **Q-P3 (marketplace timeline)** — a product/timeline call that can ride alongside MVP work rather than blocking it.

### Additional findings worth flagging

PR #2341 incidentally raised the visibility of two pre-existing inventory items that affect the plan:

1. **`dblogging` is now ON by default** (`commandHandlerContext.ts` and `agentServer/server.ts` both flipped). Every dev session now emits to the Cosmos/Mongo sinks unless explicitly disabled via `@config log db off`. This sharpens §3's "telemetry is invisible" observation — emit-only is no longer just emit-to-debug; it is **emit-to-cloud by default**. The plan should consider (a) a clear in-VS-Code indicator that remote logging is on and (b) easy local-only opt-out for sensitive corpora.
2. **`displayLog.json` is now a labeled corpus** by virtue of carrying `user-feedback` entries inline with the `set-display`/`append-display`/`set-display-info` entries that record prompts, responses, and action JSON. A single file per session contains everything the federated-corpus service needs to produce a labeled (utterance, response, action, label) tuple. The `@feedback export --format jsonl` command is effectively the first cut of a corpus-export tool already shipped — the federated-corpus design should build on that format rather than invent a new one.

---

_End of Phase 1 inventory._
