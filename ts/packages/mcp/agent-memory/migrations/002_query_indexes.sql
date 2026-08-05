CREATE INDEX search_documents_scope_kind_entity
ON search_documents(scope_id, entity_kind, entity_id);

CREATE INDEX topics_scope_parent
ON topics(scope_id, parent_topic_id, topic_id);

CREATE INDEX turn_topics_scope_topic_role
ON turn_topics(scope_id, topic_id, role, turn_id);

CREATE INDEX turn_terms_term_turn
ON turn_terms(term_id, turn_id);

CREATE INDEX turns_scope_occurred
ON turns(scope_id, occurred_at, turn_id);

CREATE INDEX turns_scope_recorded
ON turns(scope_id, recorded_at, turn_id);

CREATE INDEX artifact_changes_artifact_occurred
ON artifact_changes(artifact_id, occurred_at, turn_id);

CREATE INDEX goal_events_goal_updated
ON goal_events(goal_id, updated_at, revision);

CREATE INDEX design_note_revisions_note_updated
ON design_note_revisions(design_note_id, updated_at, revision);

CREATE INDEX topic_outputs_scope_updated
ON topic_outputs(scope_id, updated_at, output_id);

CREATE INDEX topic_property_values_updated
ON topic_property_values(updated_at, definition_id, topic_id);

CREATE TABLE search_index_state (
	singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
	index_version INTEGER NOT NULL CHECK (index_version >= 0),
	updated_at TEXT NOT NULL
) STRICT;

INSERT INTO search_index_state(singleton, index_version, updated_at)
VALUES (1, 0, '1970-01-01T00:00:00.000Z');