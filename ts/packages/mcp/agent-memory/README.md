# Agent Memory MCP

Agent Memory MCP is a standalone MCP server for durable, evidence-bearing AI
agent memory. It is developed in the TypeAgent monorepo but has no TypeAgent
runtime dependency.

Milestone 0 is runnable. The server uses the official MCP TypeScript SDK v2 over
stdio and currently exposes `memory_status`. Turn recording, SQLite persistence,
and deterministic retrieval are implemented in the following milestones.

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
