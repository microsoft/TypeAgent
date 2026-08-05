# Agent Memory MCP Implementation Plan

Status: proposed plan for the initial implementation

## Objective

Build a local TypeScript MCP server that can:

1. atomically record a structured agent turn;
2. organize turns under one primary topic and optional secondary topics;
3. index terms, actions, artifacts, and initial topic facets;
4. execute path-oriented, temporal, and Boolean queries deterministically;
5. assemble an agent-directed working-memory packet within a default 1,024-token budget; and
6. preserve the provenance and extension points needed for later LLM-assisted optimization without making any model calls in the initial implementation.

The first useful release is a vertical write-query-read slice. Generic lifecycle and maintenance tools follow once this slice proves the data model and query semantics.

## Fixed decisions

- The package is `@typeagent/agent-memory-mcp` under `packages/mcp/agent-memory`.
- TypeAgent is the initial host and consumer, not a runtime dependency. The package has no `@typeagent/*` runtime imports and remains independently buildable.
- The package owns and pins its upstream dependency versions instead of inheriting TypeAgent wrappers or version choices.
- The packed artifact is a complete MCP server that an agent can install and run without the TypeAgent repository or any other TypeAgent package.
- The server uses the official `@modelcontextprotocol/server` v2 package over stdio, with the matching client package for integration tests.
- SQLite is the authoritative local store. The package depends directly on its SQLite driver and owns WAL configuration, foreign keys, transactions, migrations, and FTS5 checks.
- Topics form a strict tree. Aliases and `related_to` edges provide alternate navigation.
- Each turn has exactly one primary topic and zero or more secondary topics.
- Authoritative records are normalized and append-only where history matters.
- Search documents, FTS rows, summaries, snippets, and usage statistics are derived and rebuildable.
- Query execution is deterministic and does not call a model.
- The path language compiles to a versioned typed query IR.
- `&` is hard AND, `|` is OR with maximum-child scoring, and `+` is soft AND ranked first by distinct logical-clause hit count.
- Relative time is resolved once using the caller's timezone and stored as an absolute interval in continuation cursors.
- The default packet budget is 1,024 estimated tokens.
- LLM optimization is deferred. The initial implementation stores derivation metadata and summary watermarks but has no model dependency, optimizer worker, consolidation, or culling implementation.

## Implementation strategy

Implement in small vertical milestones. Every milestone ends with an executable check and leaves the package buildable both inside the workspace and without TypeAgent runtime packages. Add abstractions only when the next milestone uses them.

The storage implementation is package-local and depends directly on the SQLite driver. Existing TypeAgent memory code may inform tests and design, but it is neither imported nor wrapped. The MCP adapter follows the same rule: it targets the official upstream SDK directly, while domain and query code remain independent of any MCP package.

## Milestone 0: Reconcile architecture and scaffold

### Deliverables

- Update `ARCHITECTURE.md` to include the agreed topic, turn, facet, query IR, temporal, Boolean, packet-budget, and optimization-deferral decisions.
- Replace the architecture's original query-first generic tool sequence with the vertical-slice sequence in this plan.
- Create:

  ```text
  package.json
  tsconfig.json
  src/tsconfig.json
  test/tsconfig.json
  src/index.ts
  src/server.ts
  test/serverSmoke.spec.ts
  ```

- Add a package `bin` entry for the compiled `agent-memory-mcp` stdio executable.
- Include compiled code, SQLite migrations, and required runtime metadata in the packed artifact.
- Support package-owned command-line and environment configuration for the database path, allowed scope, and logging. Do not load TypeAgent configuration.
- Add direct dependencies on:
  - `@modelcontextprotocol/server` v2;
  - `zod`.
- Add `@modelcontextprotocol/client` v2 as a direct development dependency for protocol integration tests.
- Pin tested dependency versions in this package rather than relying on TypeAgent's MCP v1 override or internal storage packages.
- Add repository-standard Jest, Prettier, Rimraf, and TypeScript scripts.
- Add a minimal stdio MCP server with `memory_status` returning schema and server versions.
- Add `.vscode/mcp.json` only after the compiled server starts successfully.
- Add the required MCP SDK documentation pointer to the repository's applicable Copilot instructions without changing unrelated guidance.

### Validation

- Package TypeScript build passes.
- Unit smoke test creates and closes the server without writing protocol noise to stdout.
- MCP client can list `memory_status` and call it over stdio.
- The package manifest has no `@typeagent/*` runtime dependencies.
- A packed-package smoke test installs the tarball in an empty temporary project, starts the executable, and calls `memory_status` without the repository or any TypeAgent package present.
- The packed tarball contains the executable and migrations but excludes source tests, temporary databases, and workspace-only files.
- Prettier passes for the package.

## Milestone 1: Domain contracts and identifiers

### Deliverables

Define dependency-free domain types under `src/domain`:

- `MemoryScope` and resolved `AccessScope`;
- `Topic`, `TopicAlias`, and topic state;
- `TurnRecord`;
- `TurnTopic` with primary and secondary roles;
- `Term`, `TermAlias`, and `TurnTerm`;
- `ActionEvent`;
- `Artifact` and `ArtifactChange`;
- `Goal`, `DesignNote`, and `TopicOutput` as the initial typed facets;
- `TopicPropertyDefinition` and `TopicPropertyValue` for extensibility;
- provenance, revision, state, and derivation metadata;
- stable domain errors and result types.

Use UUIDv7-compatible opaque string IDs behind injectable `IdGenerator` and `Clock` interfaces. Production uses real time and IDs; tests use deterministic implementations.

Define validation invariants:

- one primary topic per turn;
- no duplicate secondary topic or term links;
- topic parent and child share scope;
- topic paths use normalized slugs;
- action sequence is unique within a turn;
- artifact changes reference existing artifacts;
- output changes may reference design-note revisions;
- custom property values conform to their definitions;
- relative times never enter the repository layer.

### Validation

- Type-level build succeeds without importing MCP or SQLite.
- Unit tests cover constructors, normalization, state transitions, and validation failures.
- Domain errors contain stable codes and no storage details.

## Milestone 2: SQLite repository and migrations

### Deliverables

Create `src/repository` with a package-owned database and migration runner.
Add direct, package-pinned dependencies on the selected SQLite driver and its
types in this milestone, when SQLite first enters the executable. Verify the
native binary against the package's supported Node versions without relying on
TypeAgent's installed driver.

Authoritative tables:

- `scopes`;
- `topics` and `topic_aliases`;
- `topic_relations`;
- `turns` and `turn_topics`;
- `terms`, `term_aliases`, and `turn_terms`;
- `actions`;
- `artifacts` and `artifact_changes`;
- `goals` and `goal_events`;
- `design_notes` and `design_note_revisions`;
- `topic_outputs` and `output_design_notes`;
- `topic_property_definitions` and `topic_property_values`;
- `idempotency_records`;
- `schema_migrations`.

Derived tables:

- `search_documents`, a unified projection over searchable entity kinds;
- `search_fts`, an FTS5 table keyed by search-document ID;
- `facet_summaries` with source watermark and derivation metadata;
- `retrieval_events` and `retrieval_results`.

Database rules:

- enable WAL and foreign keys on every connection;
- wrap each public mutation in a transaction;
- enforce one primary topic per turn with a partial unique index and transaction validation for existence;
- enforce scope equality in repository code before writing cross-record relations;
- use prepared statements and bound parameters only;
- make migrations ordered, atomic, and idempotent;
- rebuild all derived search data from authoritative tables.

Repository interfaces expose domain operations rather than SQL tables. The MCP layer never receives a database handle.

### Validation

- Migration from an empty database reaches the current schema version.
- Reopening a migrated database changes nothing.
- A failed migration rolls back.
- FTS5 capability is checked with a real create/insert/match test.
- Foreign-key, primary-topic, scope, and uniqueness constraints are exercised.
- Transaction rollback leaves no partial turn or index data.
- Rebuilding derived search documents produces the same logical rows.

## Milestone 3: Atomic turn recording

### Deliverables

Implement `RecordTurnService` and the `memory_record_turn` MCP tool.

Input includes:

- stable `turnId` and idempotency key;
- conversation and sequence identifiers;
- resolved scope;
- primary topic path;
- optional secondary topic paths;
- request and outcome summaries;
- occurred-at timestamp;
- terms with optional roles;
- actions;
- artifact changes;
- optional goal, design-note, output, and custom-property updates.

Processing order in one transaction:

1. validate scope and input limits;
2. resolve or create provisional topic segments;
3. resolve aliases before creating a new topic;
4. create exactly one primary and all secondary turn-topic links;
5. normalize and resolve terms and aliases;
6. write the turn, actions, artifact events, and facet updates;
7. validate design-note links for output changes and return warnings for missing links;
8. update derived search documents and FTS rows;
9. persist the idempotency result;
10. commit and return stable IDs plus warnings.

Topic creation is unrestricted but provisional. No automatic topic merge or alias inference occurs in this milestone.

### Validation

- A complete turn is visible after one commit.
- Any validation or index-write failure rolls back the entire turn.
- Replaying an identical idempotency key returns the original result.
- Reusing a key with different input returns `IDEMPOTENCY_CONFLICT`.
- One primary and multiple secondary topics are recorded correctly.
- Missing output design notes produce warnings without losing the artifact event.
- Concurrent duplicate turn writes produce one record.

## Milestone 4: Versioned query IR

### Deliverables

Define the version 1 query IR under `src/query/ir` before implementing textual syntax.

Core nodes:

```typescript
type QueryExpression =
  | MatchExpression
  | FilterExpression
  | AndExpression
  | OrExpression
  | SoftAndExpression
  | NotExpression;
```

Semantics:

- hard AND intersects child result sets;
- OR unions child result sets and uses maximum child quality for ties;
- soft AND unions child result sets and ranks first by distinct matched-clause count;
- grouped alternatives contribute at most one hit to their parent soft-AND clause;
- aliases and multiple retrieval channels cannot produce duplicate hits for one logical clause;
- filters affect membership but not hit count;
- negation filters candidates after positive candidate generation.

Temporal selectors:

- `during` for events in an absolute interval;
- `asOf` for state at an instant;
- `changedDuring` with `matchingEvents` or `endState` projection.

Other IR components:

- target entity or facet kinds;
- canonical topic root and descendant traversal;
- primary/secondary topic-role filters;
- include and projection fields;
- ordering and stable tie-breaking;
- detail level (`cards`, `snippets`, `full`);
- token budget;
- resolved timezone metadata;
- continuation state.

Implement canonical serialization and hashing so cursors and retrieval events can bind to the exact normalized query.

### Validation

- Truth-table tests cover nested AND, OR, soft AND, and NOT.
- `quark + eigenvalue + field` ranks three distinct hits above two, and two above one regardless of lexical quality.
- `quark + (eigenvalue | spectrum) + field` gives the OR group at most one hit.
- Duplicate aliases do not increase hit count.
- Equivalent IR normalizes to the same hash.
- Invalid or unbounded queries fail before repository execution.

## Milestone 5: Path language and temporal resolution

### Deliverables

Implement a small parser under `src/query/language` that compiles to IR.

Initial path surface:

```text
/topics/{path}
/topics/{path}/turns
/topics/{path}/terms
/topics/{path}/actions
/topics/{path}/artifacts
/topics/{path}/goals
/topics/{path}/outputs
/topics/{path}/design-notes
/topics/{path}/properties/{key}
/terms/{term}/topics
/terms/{term}/turns
/artifacts/{artifactId}/turns
/turns/{turnId}
```

Initial language features:

- exact topic path segments;
- `*` for one topic level;
- `**` for recursive descendants;
- `&`, `|`, and `+` with parentheses and documented precedence;
- quoted terms and escaped path segments;
- equality, state, role, and time filters;
- detail, ordering, limit, and token-budget controls;
- relative time expressions including `today`, `yesterday`, and bounded day/week offsets.

Resolve relative time using an injected timezone-aware resolver. The parser output contains only absolute timestamps. Cursor continuation reuses the original resolved interval.

Do not add arbitrary SQL-like projection, joins, functions, or user-defined expressions in version 1.

### Validation

- Parser precedence and escaping tests are table-driven.
- Parse-render-parse round trips preserve normalized IR.
- Daylight-saving transitions produce correct absolute intervals.
- Continuations created before midnight retain their original `yesterday` interval.
- Malformed paths and excessive nesting return bounded validation errors.

## Milestone 6: Query evaluator and indexes

### Deliverables

Implement `src/query/evaluator` over repository posting sets.

Evaluation pipeline:

1. resolve the canonical topic and allowed scope;
2. generate positive candidates from structural, term, FTS, artifact, and facet indexes;
3. represent logical-clause membership with clause IDs and bit sets;
4. apply temporal and state filters;
5. evaluate nested Boolean groups;
6. deduplicate by authoritative result ID;
7. rank lexicographically by soft-AND hit count, then match quality, then stable ID;
8. project `asOf` or end-of-period state when requested;
9. return candidate records with compact match evidence.

The initial evaluator is lexical and structural. It has no embedding dependency. Query interfaces leave room for a future semantic posting source without changing Boolean semantics.

For `changedDuring` with `endState`:

1. find IDs with state or revision events in the interval;
2. select each ID's latest revision at or before the interval end;
3. render that state while retaining the matching event references.

### Validation

- Scope is applied before any candidate can enter ranking.
- Primary-only and primary-plus-secondary topic queries differ as specified.
- Topic ancestors, aliases, and recursive paths produce distinct clause evidence without duplicate results.
- Temporal tests distinguish occurred, recorded, and valid time.
- End-of-yesterday queries return the final state of items changed yesterday.
- Ordering is stable for a fixed database and normalized query.

## Milestone 7: Working-memory packet assembler

### Deliverables

Implement `src/packet` with:

- injectable `TokenEstimator`;
- conservative fallback estimator;
- facet-aware card and snippet renderers;
- deterministic deduplication;
- greedy marginal-utility-per-token selection;
- summary-plus-tail rendering using explicit watermarks;
- compact local citations mapped to stable IDs and revisions;
- opaque, integrity-protected continuation cursors;
- budget accounting and truncation metadata.

Selection priorities:

1. satisfy the query's explicit facet and projection requests;
2. rank soft-AND results by hit count before quality;
3. preserve active constraints, blockers, and recent unsummarized records when requested;
4. prefer new facets and independent evidence over repeated content;
5. stop only at semantic record boundaries;
6. target at most 90% of the requested budget to accommodate tokenizer variance and MCP framing.

The default budget is 1,024 estimated tokens. The packet does not duplicate full payloads in both MCP text and structured content.

### Validation

- Every returned packet remains within the configured conservative budget.
- A two-hit soft-AND card is never displaced by a one-hit card due only to lexical quality.
- Duplicate index paths consume one rendered slot.
- Summary-plus-tail includes every record after the watermark.
- Continuation pages do not repeat the topic brief unless requested.
- The same query, index version, and budget produce byte-stable output.

## Milestone 8: Initial MCP tool surface

### Deliverables

Expose these tools:

- `memory_record_turn`;
- `memory_query`;
- `memory_get`;
- `memory_status`.

`memory_query` accepts either the path-language string or a structured version 1 IR, never both. Its response includes the compact packet, references, estimated budget use, resolved temporal range, truncation flag, and continuation cursor.

`memory_get` retrieves exact records and revisions with an explicit token budget. It does not bypass scope checks.

Add MCP annotations, Zod validation, stable error mapping, and stderr-only diagnostic logging. The MCP adapter remains thin and contains no query or repository logic.

Add `.vscode/mcp.json` pointing to the built stdio server after the integration test passes.

### Validation

- MCP client integration tests list and invoke every tool over stdio.
- Unknown fields, invalid enums, oversized inputs, and excessive budgets fail validation.
- Inaccessible and nonexistent IDs produce indistinguishable `NOT_FOUND` responses.
- Stdio stdout contains protocol messages only.
- Server shutdown closes the database and transport.

## Milestone 9: Durable memory lifecycle

### Deliverables

After the turn-query slice is stable, add:

- `memory_store` for explicit durable assertions;
- `memory_revise` with optimistic concurrency;
- `memory_forget` using reversible tombstones;
- `memory_feedback` for explicit retrieval outcomes.

Integrate these records into the same topic, term, temporal, query, and packet infrastructure. Do not build a parallel search path.

Promote additional typed facets only when their lifecycle requires it. Candidate next facets are decisions, questions, requirements, constraints, tasks, findings, evidence, validation, risks, and dependencies. Until promoted, agents may represent them through typed custom properties or explicit durable memories.

### Validation

- Revision history and provenance remain intact.
- Revision conflicts commit no partial changes.
- Forgotten records are excluded by default and restorable.
- Feedback changes usage telemetry but never content confidence.
- New entity kinds participate in existing Boolean and temporal queries.

## Optimization provisioning only

The initial implementation includes no LLM calls and no active `memory_optimize` tool.

Provision these contracts without building a worker:

```typescript
type DerivationMetadata = {
  operation: string;
  providerId?: string;
  modelId?: string;
  promptVersion?: string;
  sourceIds: string[];
  sourceRevisions: number[];
  throughSequence?: number;
  generatedAt: string;
};
```

Derived summaries and future inferred relations carry this metadata. Repository APIs can mark derived records stale when a source revision or watermark advances.

Do not add unused model-provider abstractions, job queues, plan tables, consolidation code, or culling code until an optimization milestone is approved.

## Testing and evaluation corpus

### Unit tests

- domain validation and normalization;
- migration and transaction behavior;
- topic and alias resolution;
- term normalization;
- Boolean truth tables and clause-bit accounting;
- temporal resolution and snapshots;
- packet selection and token accounting;
- cursor integrity and stability;
- MCP schema and error mapping.

### Integration tests

- record a turn, query it by primary topic, secondary topic, term, action, and artifact;
- query yesterday's changes and end state;
- restart the server and retrieve the same data;
- continue a truncated packet without duplicates;
- rebuild search documents and obtain the same logical results;
- invoke the complete tool surface over stdio.

### Representative evaluation set

Create a checked-in synthetic corpus and query expectations covering:

- several sessions and days;
- overlapping primary and secondary topics;
- term aliases;
- created and updated artifacts;
- goals, design notes, and outputs;
- completed, failed, and blocked actions;
- revisions and superseded state;
- soft-AND partial matches;
- daylight-saving boundaries;
- enough records to require packet continuation.

Measure:

- answer-bearing-record recall within 1,024 tokens;
- current goal, blocker, output, and decision recall;
- duplicate-token ratio;
- stale or superseded content rate;
- query latency;
- deterministic output stability.

Record baseline latency rather than setting an arbitrary release gate before the corpus exists. The query path must make zero model calls by construction.

## Build and validation commands

Run from the `ts` workspace root unless noted:

```powershell
pnpm run build agent-memory-mcp
pnpm --filter @typeagent/agent-memory-mcp test
pnpm --filter @typeagent/agent-memory-mcp prettier
```

Tests run against compiled output, so build before Jest. During implementation, prefer the narrow test file for the current milestone after rebuilding the package.

## Release checkpoints

### Checkpoint A: Persistent turn ledger

Milestones 0-3 complete. The server records one atomic turn with topics, terms, actions, artifacts, and initial facets.

### Checkpoint B: Deterministic retrieval

Milestones 4-7 complete. The query language supports paths, temporal selection, hard AND, OR, soft AND, and budgeted packets.

### Checkpoint C: Usable MCP server

Milestone 8 complete. An MCP client can record and retrieve working memory over stdio.

### Checkpoint D: Durable memory lifecycle

Milestone 9 complete. Explicit assertions can be stored, revised, forgotten, and evaluated through the same query system.

LLM-assisted optimization is a separate project checkpoint after deterministic retrieval has an evaluation baseline.
