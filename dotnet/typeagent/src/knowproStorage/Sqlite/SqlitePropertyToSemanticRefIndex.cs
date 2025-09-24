// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqlitePropertyToSemanticRefIndex : IPropertyToSemanticRefIndex
{
    SqliteDatabase _db;

    public SqlitePropertyToSemanticRefIndex(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        _db = db;
    }

    public int GetCount()
    {
        return _db.GetCount(SqliteStorageProviderSchema.PropertyIndexTable);
    }

    public Task<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(GetCount());
    }

    public Task<string> AddPropertyAync(string propertyName, string value, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public void Clear() => _db.ClearTable(SqliteStorageProviderSchema.PropertyIndexTable);
    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        Clear();
        return Task.CompletedTask;
    }

    public Task<string[]> GetValuesAsync(CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<ScoredSemanticRefOrdinal[]> LookupPropertyAsync(string propertyName, string value, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
