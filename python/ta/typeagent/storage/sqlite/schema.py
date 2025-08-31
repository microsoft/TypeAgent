# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SQLite database schema definitions."""

from dataclasses import dataclass
from datetime import datetime, timezone
import typing

# Constants
CONVERSATION_SCHEMA_VERSION = "0.1"

MESSAGES_SCHEMA = """
CREATE TABLE IF NOT EXISTS Messages (
    msg_id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Messages can store chunks directly in JSON or reference external storage via URI
    chunks JSON NULL,             -- JSON array of text chunks, or NULL if using chunk_uri
    chunk_uri TEXT NULL,          -- URI for external chunk storage, or NULL if using chunks
    start_timestamp TEXT NULL,    -- ISO format with Z timezone
    tags JSON NULL,               -- JSON array of tags
    metadata JSON NULL,           -- Message metadata (source, dest, etc.)
    extra JSON NULL,              -- Extra message fields that were serialized

    CONSTRAINT chunks_xor_chunkuri CHECK (
        (chunks IS NOT NULL AND chunk_uri IS NULL) OR
        (chunks IS NULL AND chunk_uri IS NOT NULL)
    )
);
"""

TIMESTAMP_INDEX_SCHEMA = """
CREATE INDEX IF NOT EXISTS idx_messages_start_timestamp ON Messages(start_timestamp);
"""

# Conversation metadata table (single row)
CONVERSATION_METADATA_SCHEMA = """
CREATE TABLE IF NOT EXISTS ConversationMetadata (
    name_tag TEXT NOT NULL,           -- User-defined name for this conversation
    schema_version TEXT NOT NULL,     -- Version of the metadata schema
    created_at TEXT NOT NULL,         -- UTC timestamp when conversation was created
    updated_at TEXT NOT NULL,         -- UTC timestamp when metadata was last updated
    tags JSON NOT NULL,               -- JSON array of string tags
    extra JSON NOT NULL               -- JSON object for additional metadata
);
"""

SEMANTIC_REFS_SCHEMA = """
CREATE TABLE IF NOT EXISTS SemanticRefs (
    semref_id INTEGER PRIMARY KEY,
    range_json JSON NOT NULL,          -- JSON of the TextRange object
    knowledge_type TEXT NOT NULL,      -- Required to distinguish JSON types (entity, topic, etc.)
    knowledge_json JSON NOT NULL       -- JSON of the Knowledge object
);
"""

SEMANTIC_REF_INDEX_SCHEMA = """
CREATE TABLE IF NOT EXISTS SemanticRefIndex (
    term TEXT NOT NULL,             -- lowercased, not-unique/normalized
    semref_id INTEGER NOT NULL,

    FOREIGN KEY (semref_id) REFERENCES SemanticRefs(semref_id) ON DELETE CASCADE
);
"""

SEMANTIC_REF_INDEX_TERM_INDEX = """
CREATE INDEX IF NOT EXISTS idx_semantic_ref_index_term ON SemanticRefIndex(term);
"""

MESSAGE_TEXT_INDEX_SCHEMA = """
CREATE TABLE IF NOT EXISTS MessageTextIndex (
    msg_id INTEGER NOT NULL,
    chunk_ordinal INTEGER NOT NULL,

    PRIMARY KEY (msg_id, chunk_ordinal),
    FOREIGN KEY (msg_id) REFERENCES Messages(msg_id) ON DELETE CASCADE
);
"""

MESSAGE_TEXT_INDEX_MESSAGE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_message_text_index_message ON MessageTextIndex(msg_id, chunk_ordinal);
"""

PROPERTY_INDEX_SCHEMA = """
CREATE TABLE IF NOT EXISTS PropertyIndex (
    prop_name TEXT NOT NULL,
    value_str TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 1.0,
    semref_id INTEGER NOT NULL,

    FOREIGN KEY (semref_id) REFERENCES SemanticRefs(semref_id) ON DELETE CASCADE
);
"""

PROPERTY_INDEX_PROP_NAME_INDEX = """
CREATE INDEX IF NOT EXISTS idx_property_index_prop_name ON PropertyIndex(prop_name);
"""

PROPERTY_INDEX_VALUE_STR_INDEX = """
CREATE INDEX IF NOT EXISTS idx_property_index_value_str ON PropertyIndex(value_str);
"""

PROPERTY_INDEX_COMBINED_INDEX = """
CREATE INDEX IF NOT EXISTS idx_property_index_combined ON PropertyIndex(prop_name, value_str);
"""

RELATED_TERMS_ALIASES_SCHEMA = """
CREATE TABLE IF NOT EXISTS RelatedTermsAliases (
    term TEXT NOT NULL,
    alias TEXT NOT NULL,

    PRIMARY KEY (term, alias)
);
"""

RELATED_TERMS_ALIASES_TERM_INDEX = """
CREATE INDEX IF NOT EXISTS idx_related_aliases_term ON RelatedTermsAliases(term);
"""

RELATED_TERMS_ALIASES_ALIAS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_related_aliases_alias ON RelatedTermsAliases(alias);
"""

RELATED_TERMS_FUZZY_SCHEMA = """
CREATE TABLE IF NOT EXISTS RelatedTermsFuzzy (
    term TEXT NOT NULL,
    related_term TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 1.0,

    PRIMARY KEY (term, related_term)
);
"""

RELATED_TERMS_FUZZY_TERM_INDEX = """
CREATE INDEX IF NOT EXISTS idx_related_fuzzy_term ON RelatedTermsFuzzy(term);
"""

RELATED_TERMS_FUZZY_RELATED_INDEX = """
CREATE INDEX IF NOT EXISTS idx_related_fuzzy_related ON RelatedTermsFuzzy(related_term);
"""

RELATED_TERMS_FUZZY_SCORE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_related_fuzzy_score ON RelatedTermsFuzzy(score);
"""

# Type aliases for database row tuples
type ShreddedMessage = tuple[
    str | None, str | None, str | None, str | None, str | None, str | None
]
type ShreddedSemanticRef = tuple[int, str, str, str]
type ShreddedMessageText = tuple[int, int, str, bytes | None]
type ShreddedPropertyIndex = tuple[str, str, float, int]
type ShreddedRelatedTermsAlias = tuple[str, str]
type ShreddedRelatedTermsFuzzy = tuple[str, str, float]


@dataclass
class ConversationMetadata:
    """Metadata for the current conversation stored in SQLite."""

    name_tag: str
    schema_version: str
    created_at: datetime
    updated_at: datetime
    tags: list[str]
    extra: dict[str, typing.Any]


def _datetime_to_utc_string(dt: datetime) -> str:
    """Convert datetime to UTC ISO string. Assumes local timezone if naive."""
    if dt.tzinfo is None:
        # Assume local timezone
        dt = dt.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return dt.astimezone(timezone.utc).isoformat()


def _string_to_utc_datetime(s: str) -> datetime:
    """Convert ISO string to UTC datetime."""
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def _create_default_metadata() -> ConversationMetadata:
    """Create a ConversationMetadata with all defaults."""
    now = datetime.now(timezone.utc)
    return ConversationMetadata(
        name_tag="",
        schema_version=CONVERSATION_SCHEMA_VERSION,
        created_at=now,
        updated_at=now,
        tags=[],
        extra={},
    )
