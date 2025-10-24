// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public static class SqliteStorageProviderSchema
{
    public const string ConversationMetadataSchema = @"
CREATE TABLE IF NOT EXISTS ConversationMetadata (
    name_tag TEXT NOT NULL,           -- User-defined name for this conversation
    schema_version TEXT NOT NULL,     -- Version of the metadata schema
    created_at TEXT NOT NULL,         -- UTC timestamp when conversation was created
    updated_at TEXT NOT NULL,         -- UTC timestamp when metadata was last updated
    tags JSON NOT NULL,               -- JSON array of string tags
    extra JSON NOT NULL               -- JSON object for additional metadata
);
";

    public const string MessagesTable = "Messages";
    public const string MessagesSchema = @"
CREATE TABLE IF NOT EXISTS Messages(
    msg_id INTEGER PRIMARY KEY,
    -- Messages can store chunks directly in JSON or reference external storage via URI
    chunks JSON NULL,             -- JSON array of text chunks, or NULL if using chunk_uri
    chunk_uri TEXT NULL,          -- URI for external chunk storage, or NULL if using chunks
    message_length INTEGER,       -- Message length, if provided
    start_timestamp TEXT NULL,    -- ISO format with Z timezone
    tags JSON NULL,               -- JSON array of tags
    metadata JSON NULL,           -- Message metadata(source, dest, etc.)
    extra JSON NULL,              -- Extra message fields that were serialized

    CONSTRAINT chunks_xor_chunkuri CHECK(
        (chunks IS NOT NULL AND chunk_uri IS NULL) OR
        (chunks IS NULL AND chunk_uri IS NOT NULL)
    )
);
";

    public const string TimestampIndex = @"
CREATE INDEX IF NOT EXISTS idx_messages_start_timestamp ON Messages(start_timestamp);
";

    public const string SemanticRefTable = "SemanticRefs";
    public const string SemanticRefsSchema = @"
CREATE TABLE IF NOT EXISTS SemanticRefs (
    semref_id INTEGER PRIMARY KEY,
    range_json JSON NOT NULL,          -- JSON of the TextRange object
    knowledge_type TEXT NOT NULL,      -- Required to distinguish JSON types (entity, topic, etc.)
    knowledge_json JSON NOT NULL       -- JSON of the Knowledge object
);
";

    public const string SemanticRefIndexTable = "SemanticRefIndex";
    public const string SemanticRefIndexSchema = @"
CREATE TABLE IF NOT EXISTS SemanticRefIndex (
    term TEXT NOT NULL,             -- lowercased, not-unique/normalized
    semref_id INTEGER NOT NULL,
    score REAL NOT NULL DEFAULT 1.0,

    FOREIGN KEY (semref_id) REFERENCES SemanticRefs(semref_id) ON DELETE CASCADE
);
";

    public const string PropertyIndexTable = "PropertyIndex";
    public const string PropertyIndexSchema = @"
CREATE TABLE IF NOT EXISTS PropertyIndex (
    prop_name TEXT NOT NULL,
    value_str TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 1.0,
    semref_id INTEGER NOT NULL,

    FOREIGN KEY (semref_id) REFERENCES SemanticRefs(semref_id) ON DELETE CASCADE
);
";

    public const string PropertyIndexNameIndex = @"
CREATE INDEX IF NOT EXISTS idx_property_index_prop_name ON PropertyIndex(prop_name);
";

    public const string PropertyIndexValueStrIndex = @"
CREATE INDEX IF NOT EXISTS idx_property_index_value_str ON PropertyIndex(value_str);
";

    public const string PropertyIndexCombinedIndex = @"
CREATE INDEX IF NOT EXISTS idx_property_index_combined ON PropertyIndex(prop_name, value_str);
";


    public const string RelatedTermsAliasesTable = "RelatedTermsAliases";

    public const string RelatedTermsAliases = @"
CREATE TABLE IF NOT EXISTS RelatedTermsAliases (
    term TEXT NOT NULL,
    alias TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (term, alias)
);
";

    public const string RelatedTermsAliasesTermIndex = @"
CREATE INDEX IF NOT EXISTS idx_related_aliases_term ON RelatedTermsAliases(term);
";

    public const string RelatedTermsAliasesAliasIndex = @"
CREATE INDEX IF NOT EXISTS idx_related_aliases_alias ON RelatedTermsAliases(alias);
";

    public const string RelatedTermsFuzzyTable = "RelatedTermsFuzzy";
    public const string RelatedTermsFuzzySchema = @"
CREATE TABLE IF NOT EXISTS RelatedTermsFuzzy(
term_id INTEGER PRIMARY KEY AUTOINCREMENT,
term TEXT NOT NULL UNIQUE,      -- Will also create an index
term_embedding BLOB NOT NULL    -- Serialized embedding for the term
);
";

    public static string GetSchema()
    {
        string[] subSchemas = [
            ConversationMetadataSchema,
            MessagesSchema,
            TimestampIndex,
            SemanticRefsSchema,
            SemanticRefIndexSchema,
            PropertyIndexSchema,
            PropertyIndexNameIndex,
            PropertyIndexValueStrIndex,
            PropertyIndexCombinedIndex,
            RelatedTermsAliases,
            RelatedTermsAliasesTermIndex,
            RelatedTermsAliasesAliasIndex,
            RelatedTermsFuzzySchema,
        ];
        return string.Join("\n", subSchemas);
    }
}
