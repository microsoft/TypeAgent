// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteTermToSemanticRefIndex : ITermToSemanticRefIndex
{
    SqliteDatabase _db;

    public SqliteTermToSemanticRefIndex(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        _db = db;
    }

    public int GetCount() => _db.GetCount(SqliteStorageProviderSchema.SemanticRefIndexTable);

    public ValueTask<int> GetCountAsync(CancellationToken cancellation = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public string AddTerm(string term, int semanticRefOrdinal)
    {
        return AddTerm(term, ScoredSemanticRefOrdinal.New(semanticRefOrdinal));
    }

    public string AddTerm(string term, ScoredSemanticRefOrdinal scoredOrdinal)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(term, nameof(term));
        KnowProVerify.ThrowIfInvalidSemanticRefOrdinal(scoredOrdinal.SemanticRefOrdinal);

        term = PrepareTerm(term);

        using var cmd = _db.CreateCommand(@"
INSERT OR IGNORE INTO SemanticRefIndex (term, semref_id, score)
VALUES (@term, @semref_id, @score)
");
        cmd.AddParameter("@term", term);
        cmd.AddParameter("@semref_id", scoredOrdinal.SemanticRefOrdinal);
        cmd.AddParameter("@score", scoredOrdinal.Score);
        cmd.ExecuteNonQuery();
        return term;
    }

    public ValueTask<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellation = default)
    {
        return ValueTask.FromResult<string>(AddTerm(term, scoredOrdinal));
    }

    public void Clear() => _db.ClearTable(SqliteStorageProviderSchema.SemanticRefIndexTable);

    public ValueTask ClearAsync(CancellationToken cancellation = default)
    {
        Clear();
        return ValueTask.CompletedTask;
    }

    public IList<string> GetTerms()
    {
        return _db.GetList("SELECT DISTINCT term FROM SemanticRefIndex ORDER BY term", (reader) =>
        {
            return reader.GetString(0);
        });
    }

    public ValueTask<IList<string>> GetTermsAsync(CancellationToken cancellation = default)
    {
        return ValueTask.FromResult(GetTerms());
    }

    public IList<ScoredSemanticRefOrdinal> LookupTerm(string term)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(term, nameof(term));

        term = PrepareTerm(term);
        using var cmd = _db.CreateCommand(@"
SELECT semref_id, score FROM SemanticRefIndex WHERE term = @term
ORDER BY semref_id ASC
");
        cmd.AddParameter("@term", term);

        using var reader = cmd.ExecuteReader();
        return reader.GetList((reader) =>
        {
            int iCol = 0;
            return new ScoredSemanticRefOrdinal
            {
                SemanticRefOrdinal = reader.GetInt32(iCol++),
                Score = reader.GetFloat(iCol)
            };
        });
    }

    public ValueTask<IList<ScoredSemanticRefOrdinal>> LookupTermAsync(string term, CancellationToken cancellation = default)
    {
        return ValueTask.FromResult(LookupTerm(term));
    }

    public ValueTask<int> GetMaxOrdinalAsync(CancellationToken cancellationToken = default)
    {
        int maxId =_db.Get(
            "SELECT MAX(semref_id) from SemanticRefIndex",
            null,
            (reader) => reader.GetInt32(0)
        );

        return ValueTask.FromResult(maxId);
    }

    public void RemoveTerm(string term, int semanticRefOrdinal)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(term, nameof(term));
        KnowProVerify.ThrowIfInvalidSemanticRefOrdinal(semanticRefOrdinal);

        term = PrepareTerm(term);

        ArgumentVerify.ThrowIfNullOrEmpty(term, nameof(term));
        KnowProVerify.ThrowIfInvalidSemanticRefOrdinal(semanticRefOrdinal);

        using var cmd = _db.CreateCommand("DELETE FROM SemanticRefIndex WHERE term = @term AND semref_id = @semref_id");
        cmd.AddParameter("@term", term);
        cmd.AddParameter("@semref_id", semanticRefOrdinal);
        cmd.ExecuteNonQuery();
    }

    public ValueTask RemoveTermAsync(string term, int semanticRefOrdinal, CancellationToken cancellation = default)
    {
        RemoveTerm(term, semanticRefOrdinal);
        return ValueTask.CompletedTask;
    }

    private string PrepareTerm(string term)
    {
        term = Term.PrepareTermText(term);
        ArgumentVerify.ThrowIfNullOrEmpty(term, nameof(term));
        return term;
    }
}
