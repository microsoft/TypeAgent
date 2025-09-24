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

    public Task<string> AddPropertyAync(string propertyName, string value, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
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
