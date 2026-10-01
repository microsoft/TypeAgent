# Memory system implementation status

**Audience:** feature owners, reviewers, and release planners.

**Status date:** 2026-10-01

This ledger separates implementation from validation. A checked implementation
item means the code and focused tests exist; it does not imply that every live
acceptance scenario has passed.

## Architecture decisions in force

- KnowPro is the only retrieval engine for documents, conversations and
  how-tos (structured first, KnowPro-owned embedding fallback).
- One model-driven `content` pipeline. Basic mode, substring scoring and the
  fast/balanced/deep import profiles are removed.
- Source revisions, event ledgers, procedure versions and forget tombstones are
  canonical. Derived indexes carry `index-schema.json` and are reset and
  rebuilt, not migrated.
- Conversation memory is the event ledger in the profile conversation corpus.
  The separate per-conversation store and unified index are gone in hosts with a
  durable service.
- `@memory` plus the `@memory-mcp` runtime agent, and the Copilot CLI memory
  plugin with its own store, are deliberate parallel experiments for an
  externally consumable MCP package.

## Delivered implementation

- [x] Profile-scoped durable memory service with corpora, sources, revisions,
      jobs, search, answers, graph data, replacement, forgetting, reindexing,
      and knowledge curation.
- [x] Single `content` pipeline and versioned derived-index reset-and-rebuild
      for documents, conversation events and procedures.
- [x] Synthesized answers: `answer` generates the answer with KnowPro's answer
      generator over retrieved evidence, with citations and an explicit
      `extractive` mode. Browser page Q&A uses the same service answer.
- [x] Conversation event ledger written by the dispatcher (user, assistant,
      verified action result, decision, task outcome) with authority labels,
      idempotency, tombstones and KnowPro projection.
- [x] Conversation find, search, summarize and historical backfill over the
      ledger; Copilot session import.
- [x] Authenticated loopback MCP adapter over the durable service.
- [x] Native `@memory` agent with secure Markdown file/folder import, persisted
      batch state (version 2), command completion, and management flows.
- [x] Browser ingestion through the durable service, activity events, "Save this
      page", and the Memory Center management UI.
- [x] Procedure settings, candidates, immutable versions, citations, stale
      tracking, KnowPro-backed search, archive, and procedure-to-skill/macro
      preview and promotion over RPC and Copilot plugin tools.
- [x] Legacy website-memory persistence, graph builders, indexing service and
      `@index create website` removed; the package is limited to browser-data
      import helpers and HTML content extraction.

## Acceptance pending

- [ ] Run live current-page capture, bookmark/history import, and HTML-folder
      import against the browser extension.
- [ ] Verify cancellation produces one terminal UI result and cancelled
      content is not searchable.
- [ ] Establish the full-page import performance baseline and budget.
- [ ] Run the complete local knowledge-base journey across restart: import,
      ask, inspect, replace, forget, and reindex.
- [ ] Complete durable conversation-event parity and end-to-end retrieval
      acceptance.
- [ ] Evaluate synthesized answer quality with a live model (offline tests use
      deterministic models and a stub answer generator).
- [ ] Run affected package builds, focused tests, formatting, and repository
      ratchets in a fully restored workspace.

## Remaining product work

| Priority  | Work                                          | Exit condition                                                                                                     |
| --------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Near term | External MCP reach                            | Endpoint and token are discoverable by external clients; standalone MCP uses the same store or proxies to the host |
| Near term | Evaluation harness                            | Repeatable recall and token benchmarks on TypeAgent and public datasets                                            |
| Near term | Grounded editor integration                   | Editor can search citations, propose bounded edits, and preserve provenance                                        |
| Near term | Document search filters                       | Time and metadata scopes on `search` and `answer` backed by KnowPro scopes                                         |
| Next      | Procedure feedback and promotion UI           | Outcomes are measured; explicit approval creates workflow or macro artifacts from the UI                           |
| Next      | Skill grammar routing                         | `SkillGrammarIndex` is wired into the dispatcher in shadow mode first                                              |
| Next      | Projection compaction and storage restructure | Tombstoned bytes are reclaimed; revision content leaves `manifest.json`                                            |
| Later     | Remote synchronization                        | Revision, conflict, ACL, and deletion semantics work across replicas                                               |
| Later     | Advanced memory semantics                     | Temporal claims, contradiction handling, entity merge/split, and governance have explicit contracts                |

## Capability gates

```mermaid
flowchart LR
    IMPL[Focused implementation and tests]
    ACCEPT[Live scenario acceptance]
    PRODUCT[Enabled product capability]
    SCALE[Performance and recovery evidence]

    IMPL --> ACCEPT --> PRODUCT --> SCALE
```

Do not use "implemented" as a synonym for "accepted". The unchecked acceptance
items above remain the release evidence gap.

## Source documents

- [Memory architecture](../../architecture/memory/memory.md)
- [Maintainer current-system map](../../architecture/memory/current-system.md)
- [Scenario guide](../../architecture/memory/scenarios.md)
- [Conversation search plan](../conversation-search/CONVERSATION-SEARCH.md)
  (storage decisions superseded by the event ledger)
- `packages/memory/service/README.md`
- `packages/agents/memory/README.md`
- `packages/memory/mcp-server/README.md`
- `packages/agentServer/server/docs/conversation-memory.md`
