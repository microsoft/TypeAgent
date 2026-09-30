# Memory system implementation status

**Audience:** feature owners, reviewers, and release planners.

**Status date:** 2026-09-22

This ledger separates implementation from validation. A checked implementation
item means the code and focused tests exist; it does not imply that every live
acceptance scenario has passed.

## Delivered implementation

- [x] Per-conversation KnowPro memory with queued request and action-result
      extraction.
- [x] Hybrid fuzzy conversation-name lookup.
- [x] Unified cross-conversation content index with live population, Copilot
      import, content search, summarization, and historical backfill.
- [x] Profile-scoped durable memory service with corpora, sources, revisions,
      jobs, search, extractive answers, graph data, replacement, forgetting,
      and reindexing.
- [x] Authenticated loopback MCP adapter over the durable service.
- [x] Native `@memory` agent with secure Markdown file/folder import, persisted
      batch state, import profiles, command completion, and management flows.
- [x] Browser ingestion migrated to the durable service.
- [x] Browser activity events and Memory Center management UI.
- [x] Shared durable event substrate and conversation event producer.
- [x] Procedure settings, candidates, immutable versions, citations, stale
      tracking, search, and archive APIs.

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
- [ ] Run affected package builds, focused tests, formatting, and repository
      ratchets in a fully restored workspace.

## Remaining product work

| Priority  | Work                             | Exit condition                                                                                      |
| --------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Near term | Grounded editor integration      | Editor can search citations, propose bounded edits, and preserve provenance                         |
| Near term | Procedural guidance in reasoning | Retrieved procedure is visible, cited, and treated as non-executable guidance                       |
| Next      | Procedure feedback and promotion | Outcomes are measured and explicit approval creates workflow or macro artifacts                     |
| Next      | Unified-index compaction         | Tombstoned conversation bytes can be reclaimed by a tested rebuild                                  |
| Later     | Remote synchronization           | Revision, conflict, ACL, and deletion semantics work across replicas                                |
| Later     | Advanced memory semantics        | Temporal claims, contradiction handling, entity merge/split, and governance have explicit contracts |

## Capability gates

```mermaid
flowchart LR
    IMPL[Focused implementation and tests]
    ACCEPT[Live scenario acceptance]
    PRODUCT[Enabled product capability]
    SCALE[Performance and recovery evidence]

    IMPL --> ACCEPT --> PRODUCT --> SCALE
```

Do not use “implemented” as a synonym for “accepted.” Current code makes the
native agent, MCP endpoint, browser integration, Memory Center, event substrate,
and procedure APIs available. The unchecked acceptance items above remain the
release evidence gap.

## Source documents

- [Memory architecture](../../architecture/memory/memory.md)
- [Maintainer current-system map](../../architecture/memory/current-system.md)
- [Scenario guide](../../architecture/memory/scenarios.md)
- [Conversation search plan](../conversation-search/CONVERSATION-SEARCH.md)
- `packages/memory/service/README.md`
- `packages/agents/memory/README.md`
- `packages/memory/mcp-server/README.md`
