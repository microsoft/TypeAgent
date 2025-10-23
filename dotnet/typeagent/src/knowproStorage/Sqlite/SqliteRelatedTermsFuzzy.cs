// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteRelatedTermsFuzzy : ITermToRelatedTermsFuzzy
{
    SqliteDatabase _db;

    public SqliteRelatedTermsFuzzy(SqliteDatabase db, TextEmbeddingIndexSettings settings)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        _db = db;
        Settings = settings;
    }

    public TextEmbeddingIndexSettings Settings { get; }

    public int GetCount()
    {
        return _db.GetCount(SqliteStorageProviderSchema.RelatedTermsFuzzyTable);
    }

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public ValueTask AddTermsAsync(IList<string> texts)
    {
        throw new NotImplementedException();
    }

    public ValueTask<IList<Term>> LookupTermAsync(string text, int maxMatches, double minScore)
    {
        throw new NotImplementedException();
    }

    public ValueTask<IList<IList<Term>>> LookupTermAsync(IList<string> texts, int maxMatches, double minScore)
    {
        throw new NotImplementedException();
    }
}
