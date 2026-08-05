CREATE TABLE scopes (
    scope_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    agent_id TEXT,
    workspace_id TEXT,
    session_id TEXT
) STRICT;

CREATE UNIQUE INDEX scopes_identity
ON scopes(user_id, COALESCE(agent_id, ''), COALESCE(workspace_id, ''), COALESCE(session_id, ''));

CREATE TABLE topics (
    topic_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    parent_topic_id TEXT,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('provisional', 'established', 'merged', 'archived')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    merged_into_topic_id TEXT,
    UNIQUE(topic_id, scope_id),
    FOREIGN KEY(parent_topic_id, scope_id) REFERENCES topics(topic_id, scope_id),
    FOREIGN KEY(merged_into_topic_id, scope_id) REFERENCES topics(topic_id, scope_id),
    CHECK (merged_into_topic_id IS NULL OR merged_into_topic_id <> topic_id)
) STRICT;

CREATE UNIQUE INDEX topics_root_slug ON topics(scope_id, slug) WHERE parent_topic_id IS NULL;
CREATE UNIQUE INDEX topics_child_slug ON topics(scope_id, parent_topic_id, slug) WHERE parent_topic_id IS NOT NULL;

CREATE TABLE topic_aliases (
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    path TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(scope_id, path),
    FOREIGN KEY(topic_id, scope_id) REFERENCES topics(topic_id, scope_id)
) STRICT;

CREATE TABLE topic_relations (
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    source_topic_id TEXT NOT NULL,
    target_topic_id TEXT NOT NULL,
    relation TEXT NOT NULL CHECK (relation = 'related_to'),
    created_at TEXT NOT NULL,
    PRIMARY KEY(source_topic_id, target_topic_id, relation),
    FOREIGN KEY(source_topic_id, scope_id) REFERENCES topics(topic_id, scope_id),
    FOREIGN KEY(target_topic_id, scope_id) REFERENCES topics(topic_id, scope_id),
    CHECK (source_topic_id <> target_topic_id)
) STRICT;

CREATE TABLE turns (
    turn_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    conversation_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    request_summary TEXT NOT NULL,
    outcome_summary TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    UNIQUE(turn_id, scope_id),
    UNIQUE(scope_id, conversation_id, sequence)
) STRICT;

CREATE TABLE turn_topics (
    turn_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
    PRIMARY KEY(turn_id, topic_id),
    FOREIGN KEY(turn_id, scope_id) REFERENCES turns(turn_id, scope_id) ON DELETE CASCADE,
    FOREIGN KEY(topic_id, scope_id) REFERENCES topics(topic_id, scope_id)
) STRICT;

CREATE UNIQUE INDEX turn_topics_one_primary ON turn_topics(turn_id) WHERE role = 'primary';

CREATE TABLE terms (
    term_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    canonical_text TEXT NOT NULL,
    display_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(term_id, scope_id),
    UNIQUE(scope_id, canonical_text)
) STRICT;

CREATE TABLE term_aliases (
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    normalized_alias TEXT NOT NULL,
    term_id TEXT NOT NULL,
    display_alias TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(scope_id, normalized_alias),
    FOREIGN KEY(term_id, scope_id) REFERENCES terms(term_id, scope_id)
) STRICT;

CREATE TABLE turn_terms (
    turn_id TEXT NOT NULL REFERENCES turns(turn_id) ON DELETE CASCADE,
    term_id TEXT NOT NULL REFERENCES terms(term_id),
    role TEXT CHECK (role IS NULL OR role IN ('subject', 'method', 'artifact', 'person', 'place')),
    PRIMARY KEY(turn_id, term_id)
) STRICT;

CREATE TABLE actions (
    action_id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES turns(turn_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'skipped')),
    tool_name TEXT,
    affected_goal_ids_json TEXT NOT NULL,
    affected_artifact_ids_json TEXT NOT NULL,
    affected_output_ids_json TEXT NOT NULL,
    design_note_ids_json TEXT NOT NULL,
    UNIQUE(turn_id, sequence)
) STRICT;

CREATE TABLE artifacts (
    artifact_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    uri TEXT,
    state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    UNIQUE(artifact_id, scope_id)
) STRICT;

CREATE TABLE artifact_changes (
    artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
    turn_id TEXT NOT NULL REFERENCES turns(turn_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('created', 'updated', 'deleted')),
    summary TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    artifact_revision INTEGER NOT NULL CHECK (artifact_revision > 0),
    provenance_json TEXT NOT NULL,
    PRIMARY KEY(artifact_id, turn_id)
) STRICT;

CREATE TABLE goals (
    goal_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    topic_id TEXT NOT NULL,
    desired_state TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'achieved', 'abandoned')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_by_turn_id TEXT NOT NULL REFERENCES turns(turn_id),
    updated_at TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    UNIQUE(goal_id, revision),
    FOREIGN KEY(topic_id, scope_id) REFERENCES topics(topic_id, scope_id)
) STRICT;

CREATE TABLE goal_events (
    goal_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    desired_state TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_by_turn_id TEXT NOT NULL REFERENCES turns(turn_id),
    updated_at TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    PRIMARY KEY(goal_id, revision),
    FOREIGN KEY(goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE design_notes (
    design_note_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    topic_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    addressed_goal_ids_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('draft', 'accepted', 'superseded')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_by_turn_id TEXT NOT NULL REFERENCES turns(turn_id),
    updated_at TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    UNIQUE(design_note_id, revision),
    FOREIGN KEY(topic_id, scope_id) REFERENCES topics(topic_id, scope_id)
) STRICT;

CREATE TABLE design_note_revisions (
    design_note_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    addressed_goal_ids_json TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_by_turn_id TEXT NOT NULL REFERENCES turns(turn_id),
    updated_at TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    PRIMARY KEY(design_note_id, revision),
    FOREIGN KEY(design_note_id) REFERENCES design_notes(design_note_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE topic_outputs (
    output_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    topic_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('current', 'superseded', 'removed')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_by_turn_id TEXT NOT NULL REFERENCES turns(turn_id),
    updated_at TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    UNIQUE(output_id, revision),
    FOREIGN KEY(topic_id, scope_id) REFERENCES topics(topic_id, scope_id),
    FOREIGN KEY(artifact_id, scope_id) REFERENCES artifacts(artifact_id, scope_id)
) STRICT;

CREATE TABLE output_design_notes (
    output_id TEXT NOT NULL,
    output_revision INTEGER NOT NULL,
    design_note_id TEXT NOT NULL,
    design_note_revision INTEGER NOT NULL,
    PRIMARY KEY(output_id, output_revision, design_note_id, design_note_revision),
    FOREIGN KEY(output_id, output_revision) REFERENCES topic_outputs(output_id, revision) ON DELETE CASCADE,
    FOREIGN KEY(design_note_id, design_note_revision) REFERENCES design_note_revisions(design_note_id, revision)
) STRICT;

CREATE TABLE topic_property_definitions (
    definition_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    topic_id TEXT NOT NULL,
    name TEXT NOT NULL,
    value_type TEXT NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'timestamp', 'string-list')),
    required INTEGER NOT NULL CHECK (required IN (0, 1)),
    allowed_values_json TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    UNIQUE(definition_id, revision),
    UNIQUE(topic_id, name),
    FOREIGN KEY(topic_id, scope_id) REFERENCES topics(topic_id, scope_id)
) STRICT;

CREATE TABLE topic_property_values (
    definition_id TEXT NOT NULL,
    topic_id TEXT NOT NULL REFERENCES topics(topic_id),
    value_json TEXT NOT NULL,
    definition_revision INTEGER NOT NULL,
    updated_by_turn_id TEXT NOT NULL REFERENCES turns(turn_id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(definition_id, topic_id),
    FOREIGN KEY(definition_id, definition_revision) REFERENCES topic_property_definitions(definition_id, revision)
) STRICT;

CREATE TABLE idempotency_records (
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(scope_id, idempotency_key)
) STRICT;

CREATE TABLE search_documents (
    document_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    UNIQUE(entity_kind, entity_id, revision)
) STRICT;

CREATE VIRTUAL TABLE search_fts USING fts5(
    document_id UNINDEXED,
    title,
    content,
    tokenize = 'unicode61'
);

CREATE TABLE facet_summaries (
    summary_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    topic_id TEXT NOT NULL,
    facet_kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_watermark INTEGER NOT NULL CHECK (source_watermark >= 0),
    derivation_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    UNIQUE(topic_id, facet_kind),
    FOREIGN KEY(topic_id, scope_id) REFERENCES topics(topic_id, scope_id)
) STRICT;

CREATE TABLE retrieval_events (
    retrieval_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
    query_json TEXT NOT NULL,
    requested_at TEXT NOT NULL
) STRICT;

CREATE TABLE retrieval_results (
    retrieval_id TEXT NOT NULL REFERENCES retrieval_events(retrieval_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES search_documents(document_id),
    rank INTEGER NOT NULL CHECK (rank >= 0),
    score REAL NOT NULL,
    channels_json TEXT NOT NULL,
    PRIMARY KEY(retrieval_id, document_id),
    UNIQUE(retrieval_id, rank)
) STRICT;