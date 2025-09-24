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
    SqliteTermToSemanticRefIndex _semanticRefIndex;
    SqlitePropertyToSemanticRefIndex _propertyIndex;

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
        _semanticRefIndex = new SqliteTermToSemanticRefIndex(_db);
        _propertyIndex = new SqlitePropertyToSemanticRefIndex(_db);
    }

    public IMessageCollection<TMessage> Messages => _messages;

    public ISemanticRefCollection SemanticRefs => _semanticRefs;

    public ITermToSemanticRefIndex SemanticRefIndex => _semanticRefIndex;

    public IPropertyToSemanticRefIndex PropertyIndex => _propertyIndex;

    public void InitSchema()
    {
        string schemaSql = SqliteStorageProviderSchema.GetSchema();
        _db.Execute(schemaSql);
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
