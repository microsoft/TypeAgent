// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteStorageProvider<TMessage, TMeta> : IStorageProvider<TMessage>, IDisposable
    where TMessage : class, IMessage, new()
    where TMeta : IMessageMetadata, new()
{
    SqliteDatabase _db;

    public SqliteStorageProvider(
        ConversationSettings settings,
        string dirPath,
        string baseFileName,
        bool createNew = false
    )
        : this(settings, Path.Join(dirPath, baseFileName + ".db"), createNew)
    {
    }

    public SqliteStorageProvider(
        ConversationSettings settings,
        string dbPath,
        bool createNew = false
    )
    {
        if (!createNew)
        {
            FileExtensions.VerifyExists(dbPath);
        }
        _db = new SqliteDatabase(dbPath, createNew);
        ConfigureDatabase();
        if (createNew)
        {
            InitSchema();
        }
        TypedMessages = new SqliteMessageCollection<TMessage, TMeta>(_db);
        Messages = new SqliteMessageCollection(_db, typeof(TMessage), typeof(TMeta));
        SemanticRefs = new SqliteSemanticRefCollection(_db);
        SemanticRefIndex = new SqliteTermToSemanticRefIndex(_db);
        SecondaryIndexes = new ConversationSecondaryIndexes(
            new SqlitePropertyToSemanticRefIndex(_db),
            new SqliteTimestampToTextRangeIndex(_db),
            new SqliteRelatedTermsIndex(_db, settings.RelatedTermIndexSettings),
            settings.MessageTextIndexSettings.EmbeddingIndexSettings is null
            ? new NullMessageTextIndex()
            : new SqliteMessageTextIndex(_db, settings.MessageTextIndexSettings.EmbeddingIndexSettings)
        );
    }

    public IMessageCollection<TMessage> TypedMessages { get; private set; }

    public IMessageCollection Messages { get; private set; }

    public ISemanticRefCollection SemanticRefs { get; private set; }

    public ITermToSemanticRefIndex SemanticRefIndex { get; private set; }

    public IConversationSecondaryIndexes SecondaryIndexes { get; private set; }

    public void InitSchema()
    {
        string schemaSql = SqliteStorageProviderSchema.GetSchema();
        _db.Execute(schemaSql);
    }

    public IReadOnlyCache<string, Embedding>? GetEmbeddingCache()
    {
        return SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex as IReadOnlyCache<string, Embedding>;
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool fromDispose)
    {
        if (fromDispose && _db is not null)
        {
            _db.Dispose();
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
        Messages = null;
        SemanticRefs = null;
        SemanticRefIndex = null;
        SecondaryIndexes = null;
    }
}
