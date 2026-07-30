# Conversation Search — Design & Plan

Status: **in progress** — slice 1 complete (fuzzy name find, all clients); slice
2 landed (unified tagged index scaffolding + wiring + unit tests); slice 3
landed (population: live tee + Copilot batch-append). Next: slice 4 (content
search surface). Last updated: 2026-07-30.

## Goal

Let a user find conversations two ways:

1. **Fuzzy lookup by name** — "switch to the conversation named _blah_", where
   _blah_ is imprecise (typo'd, partial, or semantically close: "gym music" →
   "workout playlist setup").
2. **Content search** — "find the conversation where we were talking about /
   doing X", answered from conversation memory (knowPro), returning _which_
   conversation(s) discussed X.

Scope for now: **connected / agent-server mode only.** Standalone Shell is
deferred (decision #4).

## Current architecture (verified)

- UI-level conversations are owned by the agent-server
  [`ConversationManager`](../../../packages/agentServer/server/src/conversationManager.ts).
  Registry = `instanceDir/conversations/conversations.json`
  (`{ conversationId (UUIDv4), name, createdAt, source?, readOnly?, copilot? }`).
  Each conversation has its own `persistDir = conversations/<conversationId>/`
  and its own lazily-created `SharedDispatcher`, evicted after 5 min idle.
- `listConversations(name?)` today is a **case-insensitive substring** filter
  ([conversationManager.ts](../../../packages/agentServer/server/src/conversationManager.ts)).
- The dispatcher builds **one `conversationMemory` per session dir** in
  [`initializeMemory()`](../../../packages/dispatcher/dispatcher/src/context/memory.ts)
  (`baseFileName: "conversationMemory"`). So in connected mode there is already
  one knowPro index per conversation under its `persistDir` — but it is **siloed
  and lazy** (only present while that conversation's dispatcher is live), so
  nothing can search across conversations.
- Live turns are queued to memory via `addRequestToMemory` /
  `addResultToMemory` ([memory.ts](../../../packages/dispatcher/dispatcher/src/context/memory.ts)).
  This is the tee point for a unified index.

### Key constraint: knowPro is append-only

`ICollection` / `IMessageCollection`
([interfaces.ts](../../../packages/knowPro/src/interfaces.ts)) are **append-only**
(`append()`, no per-message remove). Message ordinals are positional and semantic
refs point at them, so **you cannot remove one conversation's messages from a
shared index without rebuilding it**. This shapes the deletion story below.

Tag scoping IS supported: `createTagSearchTermGroup(tags)` →
`PropertyNames.Tag` ([searchLib.ts](../../../packages/knowPro/src/searchLib.ts)),
`ConversationMessage` accepts `tags?: kp.MessageTag[]`, and
`MemorySettings.useScopedSearch` (experimental) uses structured tags.

## Design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Fuzzy name = **hybrid lexical + embedding** | Lexical nails exact/typo; embeddings catch semantic. Embedding pattern already exists in repo. |
| 2 | Content search = **one unified knowPro index across all conversations**, messages tagged by `conversationId` | Cross-conversation search without spinning up N dispatchers. Accept double-indexing (per-conversation **and** unified); storage is cheap. |
| 3 | **Split** the surface: `@conversation find <name>` (fuzzy) + `@conversation search <query>` (content), separate actions | Distinct intents; can unify later. |
| 4 | **Connected mode only** for now | Standalone unification is a bigger, separate effort. |
| 5 | Per-conversation index = **source of truth**; unified index = **derived/rebuildable** | Append-only means hard delete must drop the per-conversation dir; unified index is compacted by rebuild. |
| 6 | Unified-index compaction (reclaim tombstones) triggered **on idle-conversation timeout** + a startup safety check | The idle-eviction moment is contention-free; startup covers the "never idle again" case. |

## Target architecture

```mermaid
flowchart TD
  subgraph CM[ConversationManager - agent-server]
    REG[conversations.json registry] --> NIDX[ConversationNameIndex<br/>embeddings by conversationId]
    NIDX --> FIND["@conversation find (fuzzy name)"]
    UNI[(Unified knowPro index<br/>tagged by conversationId)] --> SRCH["@conversation search (content)"]
  end
  subgraph PC[per-conversation dispatcher]
    PMEM[(per-conv knowPro index<br/>source of truth)] --> MEMQ["@memory Q&A"]
  end
  TURN[live turn] --> PMEM
  TURN -. tee w/ conversationId .-> UNI
  IMPORT["@copilot import (many convos)"] --> PMEM
  IMPORT -. batch append tagged .-> UNI
```

### Search #1 — fuzzy name

Reuse the established name-index pattern from
[tabTitleIndex.mts](../../../packages/agents/browser/src/agent/tabTitleIndex.mts)
and [programNameIndex.ts](../../../packages/agents/desktop/src/programNameIndex.ts):

- `isEmbeddingAvailable()` + `openai.createEmbeddingModel(openai.apiSettingsFromEnv(openai.ModelType.Embedding))`.
- Cache `Record<conversationId, NormalizedEmbedding>`; embed on create, re-embed
  on rename, drop on delete, rebuild from `conversations.json` at startup.
- `generateEmbedding(model, query)` + `indexesOfNearest(embeddings, q, k, SimilarityType.Dot)`.
- **Hybrid**: lexical (substring + edit-distance) results first, then embedding
  nearest neighbors merged in. No embedding provider ⇒ lexical-only (graceful).

### Search #2 — content (unified index)

- A single `ConversationMemory` instance owned by `ConversationManager` at an
  instance-level path (e.g. `conversations/_unified/`), loaded once and kept warm.
- Every message appended with a `conversationId` structured tag (+ store enough
  to resolve display name at query time from the registry; never bake stale
  names into the index).
- Cross-conversation search runs unscoped, groups/ranks hits by `conversationId`.
- **Delete** ⇒ append-only, so **tombstone** the `conversationId` (filter out at
  query time) + **compact** (rebuild from surviving per-conversation indexes) on
  idle timeout / startup threshold.
- **Rename** ⇒ no index change.
- **Population**: `ConversationManager` injects a unified-memory sink +
  `conversationId` into each per-conversation dispatcher so
  `addRequestToMemory` / `addResultToMemory` tee to the unified index; standalone
  leaves the sink undefined (no-op). `@copilot import` batch-appends imported
  turns (tagged), incremental via the existing `lastSyncedTurnIndex` watermark.

## Surface (split)

- `@conversation find <query>` → `findConversation` action → new RPC
  `findConversations(query, maxMatches?)` returning scored `ConversationInfo[]`
  (new method; leaves `listConversations` substring semantics untouched).
- `@conversation search <query>` → `searchConversation` action → queries the
  unified index, returns matching conversations + snippets.
- CLI: `agent-cli conversations find <query>` and `... search <query>`.
- `.agr` grammar patterns for both ("which conversation was about X", etc.).

## Slices

- **Slice 1 — fuzzy name (`@conversation find`).** `ConversationNameIndex` in
  `ConversationManager`; `findConversations` RPC (protocol + client + server);
  `@conversation find` command + `findConversation` action + `.agr`; CLI
  `conversations find`. Self-contained, no memory-model changes.
  - **Done:** `conversationNameIndex.ts` (hybrid lexical + embedding, unit
    tested); `ConversationManager.findConversations` + create/import/rename/
    delete/seed lifecycle wiring; `findConversations` RPC across protocol,
    client, server handler (+ browser-extension adapter and client test stub);
    CLI `conversations find`. All packages build; 8/8 unit tests pass.
  - **Remaining (slice 1b):** in-chat surface — `@conversation find` command +
    `findConversation` action + `.agr` grammar, and client rendering of the
    result (the `manage-conversation` payload path, per client). Open question:
    whether "switch to the conversation about X" should find-then-switch.
  - **Slice 1b: DONE.** Extended the shared client `manage.ts` with a `find`
    subcommand + `matches` result kind + `manageFind`, and made `manageSwitch`
    fall back to a fuzzy find-then-switch (score >= 0.6) when there is no exact
    name. Rendered `matches` in the shared `render.ts` (Shell + VS Code shell)
    and the CLI + browser-extension renderers. Dispatcher: `findConversation`
    action + `@conversation find` command + `.agr` grammar (plus an "about X"
    switch phrasing). Tests: manageFind, fuzzy switch, matches render, and
    findConversation grammar (all passing). Note: "switch ... about X" =
    find-then-switch, `@conversation find` = list ranked matches.
- **Slice 2 — unified index scaffolding.** Create/open the
  `ConversationManager`-owned unified `ConversationMemory`; tagged `append`;
  tombstone-on-delete; compaction hook on idle timeout + startup.
  - **DONE:** `conversationSearchIndex.ts` — one `ConversationMemory` at
    `conversations/_unified/`, each message tagged `conv:<conversationId>`
    (plain-string knowPro `MessageTag`); `search()` runs `searchWithLanguage`,
    reads the tag back off each matched message, and groups/ranks by
    conversation via the pure, unit-tested `rankConversationMatches`. Index is
    **inert** (no-op / empty) when no model provider is configured, so it wires
    unconditionally. Population uses `extractKnowledge: true` by default
    (content search resolves through extracted knowledge, so production must
    extract; configurable via `createConversationSearchIndex(dir, {
    extractKnowledge })`). Wired into `ConversationManager`:
    created at startup, **tombstoned on delete**, closed on shutdown, and
    exposed via `indexConversationMessage()` + `searchConversationContent()`
    (the seams slices 3/4 call). Unit tests: `conversationSearchIndex.spec.ts`
    (grouping, tombstone filtering, untagged skip, snippet/conversation caps) —
    pure `rankConversationMatches`, no LLM.
  - **Deferred:** compaction/rebuild (needs population sources — lands with
    slice 3); reliable live end-to-end test. A live test was prototyped and
    removed: `searchWithLanguage` makes an LLM query-translation call per
    search, so any live search test is LLM-latency-bound and flaky.
    Empirically, extraction-off search returns no hits (content search needs
    extracted knowledge) and extraction-on ingest+search exceeded 5 min in this
    env. Coverage stays on the offline unit tests; revisit extraction-on
    latency when slice 3 wires real population.
- **Slice 3 — population.** Tee live turns (inject sink + conversationId into the
  per-conversation dispatcher); batch-append on `@copilot import` (incremental).
  - **DONE:** Added a host-injected `ConversationContentSink` to the dispatcher
    (`commandHandlerContext.ts` type + `DispatcherOptions` + `CommandHandlerContext`,
    threaded in `initializeCommandHandlerContext`). `memory.ts` calls it on every
    user turn (`addUserMessageToHistory`) and assistant turn (`addResultToMemory`),
    **ungated by the knowledge-extraction flags** — which matters because connected
    mode sets `requestKnowledgeExtraction: false` / `actionResultKnowledgeExtraction:
    false`, so the per-conversation memory tee is off there but the unified index
    still populates. `ConversationManager.ensureDispatcher` injects the sink,
    closing over the conversation id, so each dispatcher's turns land in the unified
    index tagged `conv:<id>`. Read-only Copilot mirrors never replay through the
    live tee, so `mirrorImporter` batch-calls `indexConversationMessage` for each
    imported turn's user/assistant text, gated on `created` (no double-index on
    re-import). Test: `copilotImport.spec.ts` asserts imported turns are indexed in
    order with null messages skipped.
  - **Deferred:** a dispatcher-level unit test of the live tee — importing
    `memory.ts` in isolation trips a pre-existing `memory.ts`↔`systemAgent.ts`
    circular-init TDZ (`systemAgent` calls `getMemoryCommandHandlers()` at module
    top level). The tee call sites are one-liners; coverage rests on the Copilot
    test (seam), the full build (type threading), and the slice-2 rank tests.
- **Slice 4 — content search surface.** `@conversation search` command +
  `searchConversation` action + `.agr`; CLI; group/rank by conversation.
- **Later** — unify the two commands if desired; standalone Shell support.

## Open items / risks

- Compaction cost when many conversations exist (`@copilot import`): rebuild is
  O(all messages). Mitigate with threshold trigger; consider a per-conversation
  summary index for routing if fan-out/rebuild ever hurts.
- Name resolution for tombstoned/renamed conversations in unified results must
  come from the live registry, not the index.
- Privacy: tombstoned (deleted) content physically remains in the unified index
  until compaction — ensure it is filtered from both search results and answer
  generation immediately on delete.
