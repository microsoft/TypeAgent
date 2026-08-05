ALTER TABLE search_documents
ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1));

CREATE TABLE memory_revisions (
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'instruction', 'procedure', 'episode', 'observation', 'summary')),
    content TEXT NOT NULL,
    structured_content_json TEXT,
    tags_json TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
    valid_from TEXT,
    valid_until TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(memory_id, revision)
) STRICT;

CREATE INDEX memory_revisions_scope_created
ON memory_revisions(scope_id, created_at, memory_id, revision);

CREATE TABLE memory_heads (
    memory_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    current_revision INTEGER NOT NULL CHECK (current_revision > 0),
    state TEXT NOT NULL CHECK (state IN ('active', 'superseded', 'archived', 'forgotten')),
    superseded_by TEXT,
    state_changed_at TEXT NOT NULL,
    state_reason TEXT,
    FOREIGN KEY(memory_id, current_revision) REFERENCES memory_revisions(memory_id, revision),
    FOREIGN KEY(superseded_by) REFERENCES memory_heads(memory_id)
) STRICT;

CREATE INDEX memory_heads_scope_state
ON memory_heads(scope_id, state, memory_id);

CREATE TABLE memory_state_events (
    event_id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL REFERENCES memory_heads(memory_id),
    from_state TEXT NOT NULL CHECK (from_state IN ('active', 'superseded', 'archived', 'forgotten')),
    to_state TEXT NOT NULL CHECK (to_state IN ('active', 'superseded', 'archived', 'forgotten')),
    actor_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE memory_relations (
    source_id TEXT NOT NULL REFERENCES memory_heads(memory_id),
    relation_type TEXT NOT NULL CHECK (relation_type IN ('supports', 'contradicts', 'supersedes', 'derived_from', 'related_to')),
    target_id TEXT NOT NULL REFERENCES memory_heads(memory_id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(source_id, relation_type, target_id),
    CHECK(source_id <> target_id)
) STRICT;

CREATE TABLE memory_usage (
    memory_id TEXT PRIMARY KEY REFERENCES memory_heads(memory_id),
    retrieval_count INTEGER NOT NULL DEFAULT 0 CHECK (retrieval_count >= 0),
    useful_count INTEGER NOT NULL DEFAULT 0 CHECK (useful_count >= 0),
    unhelpful_count INTEGER NOT NULL DEFAULT 0 CHECK (unhelpful_count >= 0),
    last_retrieved_at TEXT,
    last_useful_at TEXT
) STRICT;

CREATE TABLE memory_feedback (
    retrieval_id TEXT NOT NULL REFERENCES retrieval_events(retrieval_id) ON DELETE CASCADE,
    memory_id TEXT NOT NULL REFERENCES memory_heads(memory_id),
    outcome TEXT NOT NULL CHECK (outcome IN ('useful', 'unhelpful', 'unused')),
    reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(retrieval_id, memory_id)
) STRICT;