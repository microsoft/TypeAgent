# Agent Memory MCP: Architecture and Tool Contract

Status: Milestone 0 implemented; later milestones proposed

## Purpose

Agent Memory MCP is a local memory service for AI agents. It provides MCP tools to:

- store durable memories with provenance and scope;
- retrieve memories with evidence and stable identifiers;
- revise or forget memories without losing audit history;
- build and repair retrieval indexes;
- consolidate redundant memories; and
- cull low-value memories through a reviewable, reversible process.

The first implementation is a TypeScript MCP server backed by SQLite. It lives
in the TypeAgent monorepo so TypeAgent can adopt it, but it owns its upstream
SQLite and MCP dependencies and does not depend on TypeAgent runtime packages.

## Design principles

1. **The record is authoritative; indexes are derived.** A memory assertion is stored before indexing. Full-text, vector, and relationship indexes can always be rebuilt from authoritative records.
2. **Revision is append-only.** Updating a memory creates a new revision. It never silently rewrites the evidence an agent previously used.
3. **Retrieval returns evidence, not just prose.** Every result includes its stable ID, revision, provenance, scope, state, and score components.
4. **Optimization preserves lineage.** Consolidated memories cite every source memory. Culling changes visibility but does not physically erase records by default.
5. **Destructive work is two-phase.** Maintenance first produces a deterministic plan. A separate apply call executes that exact plan.
6. **Scope is enforced below the tools.** Search, retrieval, maintenance, and statistics all use the same scope predicate in the repository layer.
7. **The model proposes; deterministic code commits.** Models may extract, summarize, or identify duplicates. Transactions, validation, authorization, and state transitions remain deterministic.
8. **No embedding provider is required for correctness.** Exact lookup and SQLite full-text search work without embeddings. Vector search is an optional ranking channel.
9. **The project is independently usable.** TypeAgent is a consumer and development host, not a runtime dependency. The package owns its external dependency versions and keeps domain contracts independent of SQLite and MCP adapters.

## Non-goals for the local MVP

- distributed or multi-writer replication;
- cross-user sharing and remote authorization;
- autonomous background culling;
- treating model-generated confidence as calibrated probability;
- storing full conversation transcripts as individual durable memories by default;
- exposing arbitrary SQL through MCP.

## Initial vertical slice

The initial functional release is organized around agent turns rather than the
generic memory lifecycle described later in this document. The first vertical
slice atomically records a turn and retrieves it through cheap, redundant access
paths. Explicit assertion storage, revision, forgetting, feedback, and
optimization follow after this write-query-read path is stable.

### Turn ledger

Each completed agent turn creates one authoritative `TurnRecord` containing:

- one primary topic and zero or more secondary topics;
- request and outcome summaries;
- terms introduced or used by the turn;
- actions attempted and their outcomes;
- artifacts created, updated, or deleted;
- references to goals, design notes, and outputs changed by the turn; and
- provenance, scope, conversation sequence, and occurred-at time.

The turn is committed atomically through `memory_record_turn`. Topic, term,
artifact, action, and search-index updates either all commit or none do. A
deterministic turn ID and idempotency key make agent and future host-hook retries
safe.

### Topic organization

Topics form a strict tree with stable topic IDs and one canonical path. Aliases
and `related_to` edges provide alternate navigation without making path
resolution a general graph traversal. Agent-created topics are provisional and
may be normalized later.

Every turn has exactly one primary topic, which gives it a stable home, and may
have secondary topics for cross-cutting retrieval. References use topic IDs, so
renaming or moving a topic does not rewrite turn history.

Topics expose typed facets:

- goals describe the desired state;
- design notes record intended design and addressed goals;
- outputs identify created or maintained artifacts;
- actions form an immutable log with a lazily refreshed running summary; and
- typed custom properties allow extension without schema changes.

Output changes may reference design-note revisions. Missing design notes produce
warnings rather than suppressing truthful artifact history. Later typed facets
may include decisions, questions, requirements, constraints, tasks, findings,
evidence, validation, risks, and dependencies.

### Cheap redundant indexes

Authoritative evidence is stored once and projected into many inexpensive,
rebuildable access paths. A turn may be found through:

- its primary or secondary topics and topic ancestors;
- topic aliases and related-topic expansion;
- terms and term aliases;
- artifacts and artifact changes;
- action and facet indexes;
- time indexes; and
- full-text search.

Redundant index entries improve recall and are not duplicate memories. Query
evaluation deduplicates by stable authoritative ID before rendering. Independent
retrieval channels may strengthen a candidate, while aliases within one logical
clause count only once.

### Versioned query language

The path-oriented query language compiles into a versioned typed IR. The IR, not
the textual syntax, defines retrieval semantics and is the primary evaluator test
surface.

The query language supports:

- canonical topic paths, aliases, `*` children, and `**` descendants;
- facet, term, artifact, state, role, validity, and time filters;
- explicit projections and detail levels;
- hard AND (`&`), OR (`|`), and soft AND (`+`);
- caller-selected ordering, expansion, and token budget; and
- opaque continuation cursors bound to the normalized query and index version.

Hard AND requires every child clause. OR requires one child and uses the maximum
child score by default. Soft AND retrieves partial matches but ranks first by the
number of distinct logical clauses matched. For example, a result matching
`quark + field` ranks above one matching only `quark`, regardless of lexical
quality. Grouped alternatives contribute at most one hit.

Filters control membership without increasing hit count. Clause bit sets make
AND, OR, minimum-hit, and soft-AND evaluation deterministic and inexpensive.

### Temporal queries

The store distinguishes:

- `occurredAt`: when an action or event happened;
- `recordedAt`: when the service stored it; and
- validity time: when an assertion applies.

The query IR supports events `during` an interval, state `asOf` an instant, and
items `changedDuring` an interval projected either as matching events or their
end-of-period state. “What did we finish with yesterday?” selects items changed
yesterday and projects their latest state at yesterday's end.

Relative time is resolved once at the MCP boundary using the caller's timezone.
The IR and continuation cursor contain the resulting absolute interval, so a
later page cannot reinterpret `yesterday` after midnight.

### Working-memory packets

The querying agent controls packet contents through the query language. The
default budget is 1,024 estimated tokens. Deterministic packet construction:

1. evaluates the query and collects candidate records;
2. deduplicates authoritative IDs;
3. ranks by query semantics, with soft-AND hit count before match quality;
4. favors requested facets and additional evidence over repeated content;
5. renders facet-aware cards or snippets at semantic boundaries; and
6. returns compact references and a continuation cursor when truncated.

Append-heavy facets use a stored summary through an explicit sequence watermark
plus the raw tail after that watermark. A stale summary therefore never hides
recent events.

### Optimization boundary

Query execution is deterministic and makes no LLM call. Future LLM-assisted
optimization may refresh summaries, extract aliases, add secondary topics,
connect related records, identify contradictions, and propose consolidation or
culling. Generated data records source IDs, revisions, model and prompt versions,
and sequence watermarks.

Optimization is provisioned but not implemented in the initial release. Derived
or additive proposals may eventually be automatic with provenance. Any operation
that supersedes, archives, merges, culls, or deletes authoritative records remains
reviewable and transactional.

## Package boundary

The package will live at `packages/mcp/agent-memory` and publish as `@typeagent/agent-memory-mcp`.

```text
packages/mcp/agent-memory/
  src/
    domain/        # Records, policies, state transitions, ranking contracts
    repository/    # SQLite transactions and migrations
    indexing/      # FTS, embeddings, index jobs
    maintenance/   # Consolidation and culling planners/executors
    mcp/           # Thin MCP schemas and result adapters
    server.ts      # stdio entry point
  test/
  ARCHITECTURE.md
  README.md
  package.json
  tsconfig.json
```

The domain and repository contracts must not import the MCP SDK. The MCP layer
validates wire input, calls a domain service, and maps domain results to MCP
structured content. The SQLite adapter implements package-owned repository
contracts.

The package has no `@typeagent/*` runtime dependencies. Existing TypeAgent
packages may inform the design, but code is reused only by copying or extracting
generally useful implementation into this independently buildable package. In
particular, the package depends directly on its SQLite driver and owns its
schema, migrations, loading, and capability checks.

The publishable artifact includes the compiled stdio executable, migrations,
and runtime metadata needed to start the server. It accepts configuration
through its own command-line arguments and environment variables and does not
load TypeAgent configuration. An MCP client can install the packed artifact in
an empty directory and run it without the TypeAgent repository or any other
TypeAgent package.

## Memory model

### Identity and revision

A logical memory has a stable `memoryId`. Each change appends a `MemoryRevision` with a monotonically increasing `revision` number.

```typescript
type MemoryId = string; // UUIDv7
type Revision = number; // Starts at 1

type MemoryKind =
  | "fact"
  | "preference"
  | "instruction"
  | "procedure"
  | "episode"
  | "observation"
  | "summary";

type MemoryState = "active" | "superseded" | "archived" | "forgotten";

type MemoryScope = {
  userId: string;
  agentId?: string;
  workspaceId?: string;
  sessionId?: string;
};

type MemoryProvenance = {
  sourceType: "user" | "agent" | "tool" | "document" | "system";
  sourceId?: string;
  sourceUri?: string;
  observedAt?: string; // RFC 3339
  actorId: string;
};

type MemoryRevision = {
  memoryId: MemoryId;
  revision: Revision;
  kind: MemoryKind;
  content: string;
  structuredContent?: unknown;
  scope: MemoryScope;
  tags: string[];
  provenance: MemoryProvenance;
  confidence?: number; // [0, 1], provenance-qualified rather than truth
  importance: number; // [0, 1]
  validFrom?: string;
  validUntil?: string;
  createdAt: string;
  idempotencyKey?: string;
};
```

`structuredContent` is JSON and may support kind-specific schemas later. `content` remains required so every memory can participate in provider-independent retrieval.

### Current state

State is separate from revision content:

```typescript
type MemoryHead = {
  memoryId: MemoryId;
  currentRevision: Revision;
  state: MemoryState;
  supersededBy?: MemoryId;
  stateChangedAt: string;
  stateReason?: string;
};
```

Allowed transitions:

```text
active -> superseded -> archived
active -> archived
active -> forgotten
superseded -> archived
archived -> active
forgotten -> active
```

Restoring a forgotten or archived memory appends a state event; it does not delete the earlier event. Physical erasure is a separate administrative operation and is outside the agent-facing MVP.

### Relations and lineage

Relations are typed edges between stable memory IDs:

- `supports`: one memory provides evidence for another;
- `contradicts`: memories make incompatible assertions;
- `supersedes`: a newer memory replaces an older one for current retrieval;
- `derived_from`: a summary or consolidation was generated from source memories;
- `related_to`: weak, non-directional association.

A consolidated memory must have `derived_from` edges to all inputs. Inputs are normally marked `superseded`, not forgotten. Retrieval defaults to active heads, but callers can request lineage.

### Access statistics

Retrieval telemetry is mutable derived state, not part of a memory revision:

```typescript
type MemoryUsage = {
  memoryId: MemoryId;
  retrievalCount: number;
  lastRetrievedAt?: string;
  lastUsefulAt?: string;
  usefulCount: number;
  unhelpfulCount: number;
};
```

A search impression does not imply usefulness. Usefulness changes only through explicit feedback or a future, clearly defined outcome signal.

## MCP tool contract

Tool names use the `memory_` prefix to remain recognizable when mixed with tools from other servers. All successful tools return structured JSON plus a short text summary for clients that do not consume structured content.

Every mutation accepts an optional `idempotencyKey`. Reusing a key with identical input returns the original result; reusing it with different input returns a conflict error.

### `memory_store`

Store a new logical memory.

Input:

```typescript
{
    content: string;
    kind: MemoryKind;
    scope: MemoryScope;
    provenance: MemoryProvenance;
    structuredContent?: unknown;
    tags?: string[];
    confidence?: number;
    importance?: number; // Default 0.5
    validFrom?: string;
    validUntil?: string;
    relations?: Array<{
        type: "supports" | "contradicts" | "supersedes" | "derived_from" | "related_to";
        targetMemoryId: string;
    }>;
    idempotencyKey?: string;
}
```

Output:

```typescript
{
  memory: MemoryView;
  indexState: "pending" | "ready";
  duplicateCandidates: Array<{ memoryId: string; score: number }>;
}
```

Storing is successful once the record transaction commits. Embedding failure may leave `indexState: "pending"`; it must not roll back the memory.

### `memory_search`

Search visible, current memories using exact filters and hybrid ranking.

Input:

```typescript
{
    query: string;
    scope: MemoryScope;
    kinds?: MemoryKind[];
    tags?: string[];
    states?: MemoryState[]; // Default ["active"]
    createdAfter?: string;
    createdBefore?: string;
    validAt?: string;
    minConfidence?: number;
    includeLineage?: boolean;
    maxResults?: number; // Default 10, maximum 100
    maxContentChars?: number; // Per result
}
```

Output:

```typescript
{
  results: Array<{
    memory: MemoryView;
    score: number;
    scoreComponents: {
      lexical?: number;
      semantic?: number;
      recency: number;
      importance: number;
      confidence?: number;
    };
    matchedText?: string;
    lineage?: MemoryLineage;
  }>;
  retrievalMode: "lexical" | "hybrid";
  indexVersion: number;
  truncated: boolean;
}
```

The initial ranking function is deterministic for a fixed index version. Its weights are configuration, not part of the public contract. Scope and state filtering happen before final ranking. Semantic similarity must never bypass those filters.

### `memory_get`

Fetch exact memories without ranking.

Input:

```typescript
{
    memoryIds: string[]; // Maximum 100
    scope: MemoryScope;
    revision?: number; // Allowed only when one ID is supplied
    includeHistory?: boolean;
    includeLineage?: boolean;
}
```

Output preserves request order and reports inaccessible or unknown IDs as `notFound`; it does not reveal which case occurred.

### `memory_revise`

Append a revision to an existing logical memory.

Input:

```typescript
{
    memoryId: string;
    scope: MemoryScope;
    expectedRevision: number;
    content?: string;
    structuredContent?: unknown;
    kind?: MemoryKind;
    tags?: string[];
    confidence?: number;
    importance?: number;
    validFrom?: string | null;
    validUntil?: string | null;
    provenance: MemoryProvenance;
    reason: string;
    idempotencyKey?: string;
}
```

`expectedRevision` provides optimistic concurrency. A mismatch returns the current revision and makes no change.

### `memory_forget`

Change memory visibility through a tombstone event.

Input:

```typescript
{
    memoryIds: string[]; // Maximum 100
    scope: MemoryScope;
    reason: string;
    expectedRevisions?: Record<string, number>;
    idempotencyKey?: string;
}
```

The tool marks records `forgotten`; it does not physically erase them. It is annotated as destructive in the MCP adapter. Partial success is not allowed: the transaction changes all requested memories or none.

### `memory_feedback`

Record whether retrieved memories helped the calling agent.

Input:

```typescript
{
  retrievalId: string;
  outcomes: Array<{
    memoryId: string;
    outcome: "useful" | "unhelpful" | "unused";
    reason?: string;
  }>;
}
```

Feedback affects future maintenance signals. It never changes memory content or truth confidence.

### `memory_optimize`

Plan or apply index, consolidation, and culling work.

Input is a discriminated union:

```typescript
type OptimizeRequest =
  | {
      action: "plan";
      scope: MemoryScope;
      operations: Array<"reindex" | "consolidate" | "cull">;
      policy?: OptimizationPolicy;
    }
  | {
      action: "apply";
      scope: MemoryScope;
      planId: string;
      planHash: string;
      idempotencyKey?: string;
    }
  | {
      action: "status";
      scope: MemoryScope;
      jobId: string;
    };
```

A plan contains immutable proposed operations and aggregate impact:

```typescript
type OptimizationPlan = {
  planId: string;
  planHash: string;
  indexVersion: number;
  createdAt: string;
  expiresAt: string;
  operations: OptimizationOperation[];
  impact: {
    reindexCount: number;
    consolidationGroups: number;
    supersedeCount: number;
    archiveCount: number;
    estimatedBytesReclaimed: number;
  };
  warnings: string[];
};
```

Apply fails if the plan expired, its hash differs, the scope differs, or any affected memory revision changed. `reindex` may run asynchronously. Consolidation and culling state changes commit transactionally after all proposed derived memories have been validated.

### `memory_status`

Return service health and scope-limited statistics.

Input:

```typescript
{
    scope: MemoryScope;
    includeKinds?: boolean;
    includeIndexJobs?: boolean;
}
```

Output includes schema version, index version, active/superseded/archived/forgotten counts, pending index count, database size, and recent maintenance jobs. It never returns memory content.

## Optimization semantics

### Reindex

Reindex rebuilds or repairs derived structures from authoritative revisions and heads:

1. select visible heads for the requested scope;
2. rebuild SQLite FTS rows;
3. compute missing embeddings when an embedding provider is configured;
4. rebuild relation and filter indexes;
5. verify counts and sampled lookups;
6. atomically publish a new `indexVersion`.

Readers continue using the previous index version until publication. A failed rebuild leaves the previous version active.

### Consolidate

Consolidation targets redundant or fragmented memories. A planner may use lexical similarity, embeddings, relations, and an LLM, but each proposed group must satisfy deterministic guards:

- all inputs are in the requested scope;
- all inputs are active at their expected revisions;
- incompatible `validFrom`/`validUntil` intervals are not flattened;
- contradictions are reported rather than summarized away;
- the derived memory cites all inputs;
- no group crosses users or workspaces;
- instructions and preferences are not merged with observations or episodes.

Applying a consolidation stores the summary first, adds `derived_from` edges, and marks inputs `superseded` by the summary in one transaction.

### Cull

Culling means removing memories from default retrieval, not deleting audit data. The default cull action is `archive`.

Candidate signals may include:

- explicit expiration;
- superseded state with intact lineage;
- exact duplication;
- low importance;
- age;
- repeated retrieval without usefulness;
- source invalidation.

No single heuristic other than explicit expiration or exact duplication is sufficient by itself. The policy produces a reason and signal breakdown for every candidate.

```typescript
type OptimizationPolicy = {
  maxCandidates?: number;
  olderThanDays?: number;
  minImportance?: number;
  minRetrievalCount?: number;
  protectKinds?: MemoryKind[]; // Default ["instruction", "preference"]
  protectTags?: string[];
  cullAction?: "archive"; // MVP supports archive only
};
```

The MVP never autonomously culls `instruction` or `preference` memories. It may list them as warnings when they are expired or contradicted.

## Retrieval behavior

The default retrieval pipeline is:

1. resolve the caller's allowed scope;
2. select current heads in allowed states and validity interval;
3. collect FTS matches;
4. optionally collect vector neighbors;
5. union candidates by `memoryId`;
6. calculate normalized score components;
7. apply deterministic ranking and stable ID tie-breaking;
8. attach provenance and optional lineage;
9. record a retrieval event and return its `retrievalId`.

Search results must distinguish:

- `createdAt`: when this service recorded the revision;
- `observedAt`: when the source says the event occurred;
- `validFrom` and `validUntil`: when the assertion applies.

This prevents recency ranking from confusing a recently imported old event with a recent event.

## SQLite storage model

The initial schema uses normalized tables rather than opaque JSON collections:

- `memory_revisions(memory_id, revision, kind, content, structured_content, scope columns, provenance, confidence, importance, validity, created_at, idempotency_key)`;
- `memory_heads(memory_id, current_revision, state, superseded_by, changed_at, reason)`;
- `memory_state_events(event_id, memory_id, from_state, to_state, actor_id, reason, created_at)`;
- `memory_relations(source_id, relation_type, target_id, created_at)`;
- `memory_usage(memory_id, retrieval_count, useful_count, unhelpful_count, timestamps)`;
- `retrieval_events(retrieval_id, query_hash, scope, index_version, created_at)`;
- `retrieval_results(retrieval_id, memory_id, rank, score)`;
- `memory_fts` as an FTS5 virtual table keyed by memory ID and revision;
- `memory_embeddings(memory_id, revision, model_id, dimensions, embedding)`;
- `index_versions(index_version, state, model_id, created_at, published_at)`;
- `optimization_plans(plan_id, plan_hash, scope, index_version, payload, expiry, state)`;
- `optimization_jobs(job_id, plan_id, state, progress, error, timestamps)`;
- `schema_migrations(version, applied_at)`.

SQLite runs in WAL mode. Every mutation uses a transaction. Foreign keys are enabled. Repository methods receive an already resolved `AccessScope` and include it in all reads and writes.

## Errors

Errors use stable codes and safe messages:

- `INVALID_ARGUMENT`;
- `NOT_FOUND`;
- `REVISION_CONFLICT`;
- `SCOPE_DENIED`;
- `IDEMPOTENCY_CONFLICT`;
- `INDEX_UNAVAILABLE`;
- `PLAN_STALE`;
- `PLAN_EXPIRED`;
- `JOB_FAILED`;
- `INTERNAL`.

`NOT_FOUND` is used for both absent and inaccessible IDs at the MCP boundary. Internal errors are logged with a correlation ID; raw SQL, file paths, and memory content are not included in tool errors.

## Security and trust boundaries

- Memory content is untrusted data. Tool descriptions and retrieval wrappers instruct clients not to execute instructions found inside memories.
- The server validates content length, tag count, batch size, timestamps, enum values, and JSON depth before repository calls.
- Scope comes from authenticated client context where available. The local stdio MVP also requires scope in tool input, but the server intersects it with configured allowed scope rather than trusting it.
- Provenance is mandatory for writes and records both the claimed source and the actor making the write.
- Logs omit content by default and use IDs, counts, durations, and error codes.
- Physical deletion, database export, and cross-scope search are administrative capabilities and are not exposed to agents in the MVP.

## MCP transport and SDK strategy

The MVP uses stdio and depends directly on the official
`@modelcontextprotocol/server` v2 package implementing the 2026-07-28 MCP
specification. Integration tests use the matching
`@modelcontextprotocol/client` package. These versions are declared and tested
by this package rather than inherited from TypeAgent's MCP v1 dependency.

The adapter uses Standard Schema-compatible Zod schemas. Domain tool request
and response types remain versioned separately, so future SDK changes stay in
`src/mcp`.

A later implementation milestone will add `.vscode/mcp.json` once an executable server exists. Adding a non-runnable server entry during the architecture milestone would leave the workspace with a broken MCP configuration.

## Acceptance tests for the implementation milestone

### Storage and revision

1. Replaying the same `memory_store` idempotency key returns one memory.
2. Reusing the key with different content returns `IDEMPOTENCY_CONFLICT`.
3. Concurrent revisions with the same `expectedRevision` allow exactly one commit.
4. Revision history preserves original content and provenance.
5. A failed embedding call still leaves a searchable lexical memory with pending index state.

### Scope and privacy

6. Search never returns a memory outside the resolved scope.
7. Get returns `NOT_FOUND` for both inaccessible and nonexistent IDs.
8. Consolidation and culling reject cross-scope plans.
9. Status returns counts only for the resolved scope.

### Retrieval

10. Exact lexical matches work without an embedding provider.
11. Hybrid results expose lexical and semantic score components.
12. Superseded, archived, and forgotten memories are excluded by default.
13. Stable tie-breaking returns the same order for a fixed index version.
14. Validity filtering uses `validFrom`/`validUntil`, not import time.
15. Every result carries ID, revision, provenance, state, and retrieval ID.

### Optimization

16. Reindex failure leaves the previous index version available.
17. Applying an expired or modified plan makes no changes.
18. Applying a plan after an affected revision changes returns `PLAN_STALE`.
19. Consolidation creates complete lineage before superseding inputs.
20. Contradictory memories are not silently consolidated.
21. Cull defaults to archive and is reversible.
22. A maintenance transaction either applies every state change or none.
23. Protected kinds are not culled by the default policy.

### MCP adapter

24. Every tool rejects unknown enum values and oversized batches.
25. Mutation tools advertise accurate read-only/destructive annotations.
26. Domain errors map to stable, content-safe MCP errors.
27. The stdio server emits no non-protocol output on stdout.

## Open decisions before implementation

1. **Embedding interface:** define a narrow package-owned port before adding any embedding provider.
2. **Scope source:** determine which MCP client identity fields are available in the v2 SDK and how local configuration grants allowed scopes.
3. **Content limits:** select maximum content length, structured JSON depth, tag count, and database quota.
4. **Ranking defaults:** calibrate lexical, semantic, recency, importance, and confidence weights against a representative agent-memory corpus.
5. **Maintenance model:** choose the model and prompt contract for optional extraction and consolidation proposals.

These decisions can change implementation choices without changing the tool semantics or invariants above.
