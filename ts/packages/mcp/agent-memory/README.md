# Agent Memory MCP

Agent Memory MCP is a standalone MCP server for durable, evidence-bearing AI
agent memory. It is developed in the TypeAgent monorepo but has no TypeAgent
runtime dependency.

Milestones 0-4 are runnable. The server uses the official MCP TypeScript SDK v2
over stdio, initializes its package-owned SQLite database, applies ordered
migrations, and exposes `memory_status` and `memory_record_turn`. Turn recording
atomically resolves topics and terms, writes actions and memory facets, rebuilds
search projections, and persists an idempotent result. Deterministic retrieval is
implemented in the following milestones.

The version 1 query IR defines bounded Boolean, soft-AND, filter, topic, and
temporal queries before textual query parsing is introduced. It includes
canonical normalization and hashing for stable retrieval events and cursors.

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
