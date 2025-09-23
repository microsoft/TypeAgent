// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteStorageProvider<TMessage, TMeta> : IStorageProvider<TMessage>, IDisposable
    where TMessage : class, IMessage, new()
    where TMeta : IMessageMetadata, new()
{
    SqliteDatabase _db;
    SqliteMessageCollection<TMessage, TMeta> _messages;
    SqliteSemanticRefCollection _semanticRefs;

    public SqliteStorageProvider(string dirPath, string baseFileName, bool createNew = false)
        : this(Path.Join(dirPath, baseFileName + ".db"), createNew)
    {

    }

    public SqliteStorageProvider(string dbPath, bool createNew = false)
    {
        _db = new SqliteDatabase(dbPath, createNew);
        ConfigureDatabase();
        if (createNew)
        {
            InitSchema();
        }
        _messages = new SqliteMessageCollection<TMessage, TMeta>(_db);
        _semanticRefs = new SqliteSemanticRefCollection(_db);
    }

    public IMessageCollection<TMessage> Messages => _messages;

    public ISemanticRefCollection SemanticRefs => _semanticRefs;

    public void InitSchema()
    {
        _db.Execute(SqliteStorageProviderSchema.ConversationMetadataSchema);
        _db.Execute(SqliteStorageProviderSchema.MessagesSchema);
        _db.Execute(SqliteStorageProviderSchema.SemanticRefsSchema);
        _db.Execute(SqliteStorageProviderSchema.SemanticRefIndexSchema);
        _db.Execute(SqliteStorageProviderSchema.TimestampIndexSchema);
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool fromDispose)
    {
        if (fromDispose)
        {
            _db?.Dispose();
            Clear();
        }
    }

    void ConfigureDatabase()
    {
        // Configure SQLite for optimal performance
        this._db.Execute("PRAGMA foreign_keys = OFF");
        // Improve write performance for bulk operations
        this._db.Execute("PRAGMA synchronous = NORMAL"); // Faster than FULL, still safe
        this._db.Execute("PRAGMA journal_mode = WAL");  // Write-Ahead Logging for better concurrency
    }

    void Clear()
    {
        _db = null;
        _messages = null;
        _semanticRefs = null;
    }

}

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

    public const string TimestampIndexSchema = @"
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
    score REAL NOT NULL,
    FOREIGN KEY (semref_id) REFERENCES SemanticRefs(semref_id) ON DELETE CASCADE
);
";

}
