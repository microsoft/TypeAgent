# Agent Memory MCP

Agent Memory MCP is a standalone MCP server for durable, evidence-bearing AI
agent memory. It is developed in the TypeAgent monorepo but has no TypeAgent
runtime dependency.

Milestones 0-7 are runnable. The server uses the official MCP TypeScript SDK v2
over stdio, initializes its package-owned SQLite database, applies ordered
migrations, and exposes `memory_status` and `memory_record_turn`. Turn recording
atomically resolves topics and terms, writes actions and memory facets, rebuilds
search projections, and persists an idempotent result.

The version 1 query IR defines bounded Boolean, soft-AND, filter, topic, and
temporal queries before textual query parsing is introduced. It includes
canonical normalization and hashing for stable retrieval events and cursors.

The path language compiles topic, term, artifact, and direct-turn routes into
the query IR. Optional controls add Boolean expressions, filters, temporal
selection, detail, ordering, result limits, and token budgets:

```text
/topics/project/memory/**/turns where "quark field" + (eigenvalue | spectrum) filter state=active during yesterday detail snippets order hitCount:desc limit 25 tokens 2048
```

Expression precedence, from strongest to weakest, is negation (`!`), hard AND
(`&`), OR (`|`), then soft AND (`+`). Relative day and week expressions are
resolved once in the caller's IANA timezone. Rendered queries and continuation
state retain the resulting absolute interval across midnight and DST changes.

The query evaluator executes normalized IR over scope-filtered topic, term,
artifact, facet, and FTS posting sets. It preserves logical-clause evidence,
deduplicates authoritative IDs, ranks soft-AND hits before match quality, and
supports occurred, recorded, `asOf`, and end-of-period revision projection.
Search rebuilds advance a persistent index version used to reject stale
continuations. The working-memory packet assembler renders facet-aware cards or
snippets, selects records deterministically within a conservative token budget,
maps compact citations to stable IDs and revisions, preserves summary tails by
watermark, and issues integrity-protected continuation cursors. The MCP retrieval
tool is introduced in the next milestone.

```powershell
npm ci
npm run build
npm test
npm start
```

Run these commands from `packages/mcp/agent-memory`. The publishable tarball
contains the compiled executable and migrations and can be installed without
the TypeAgent repository.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for:

- memory records, revisions, provenance, scope, and lineage;
- the MCP request and response contracts;
- SQLite storage and indexing boundaries;
- two-phase consolidation and culling;
- security and failure semantics; and
- implementation acceptance tests.

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the staged vertical
slice from atomic turn recording through deterministic, token-budgeted MCP
retrieval.

The package is `@typeagent/agent-memory-mcp`, located at
`packages/mcp/agent-memory` in the TypeAgent workspace.
