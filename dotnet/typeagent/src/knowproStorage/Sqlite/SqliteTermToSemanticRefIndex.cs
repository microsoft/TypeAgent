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

    public int GetCount()
    {
        return _db.GetCount(SqliteStorageProviderSchema.SemanticRefIndexTable);
    }

    public Task<int> GetCountAsync(CancellationToken cancellation = default)
    {
        return Task.FromResult(GetCount());
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

    public Task<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellation = default)
    {
        return Task.FromResult<string>(AddTerm(term, scoredOrdinal));
    }

    public void Clear()
    {
        using var cmd = _db.CreateCommand("DELETE FROM SemanticRefIndex");
        cmd.ExecuteNonQuery();
    }

    public Task ClearAsync(CancellationToken cancellation = default)
    {
        Clear();
        return Task.CompletedTask;
    }

    public Task<string[]> GetTermsAsync(CancellationToken cancellation = default)
    {
        throw new NotImplementedException();
    }

    public IList<ScoredSemanticRefOrdinal> LookupTerm(string term)
    {
        term = PrepareTerm(term);
        using var cmd = _db.CreateCommand("SELECT semref_id, score FROM SemanticRefIndex WHERE term = @term");
        cmd.AddParameter("@term", term);

        using var reader = cmd.ExecuteReader();
        IList<ScoredSemanticRefOrdinal> matches = [];
        while (reader.Read())
        {
            int iCol = 0;
            ScoredSemanticRefOrdinal scoredOrdinal = new()
            {
                SemanticRefOrdinal = reader.GetInt32(iCol++),
                Score = reader.GetFloat(iCol)
            };
            matches.Add(scoredOrdinal);
        }
        return matches;
    }

    public Task<IList<ScoredSemanticRefOrdinal>> LookupTermAsync(string term, CancellationToken cancellation = default)
    {
        return Task.FromResult(LookupTerm(term));
    }

    public void RemoveTerm(string term, int semanticRefOrdinal)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(term, nameof(term));
        KnowProVerify.ThrowIfInvalidSemanticRefOrdinal(semanticRefOrdinal);

        term = PrepareTerm(term);
        using var cmd = _db.CreateCommand("DELETE FROM SemanticRefIndex WHERE term = @term AND semref_id = @semref_id");
        cmd.AddParameter("@term", term);
        cmd.AddParameter("@semref_id", semanticRefOrdinal);
        cmd.ExecuteNonQuery();
    }

    public Task RemoveTermAsync(string term, int semanticRefOrdinal, CancellationToken cancellation = default)
    {
        RemoveTerm(term, semanticRefOrdinal);
        return Task.CompletedTask;
    }

    private string PrepareTerm(string term)
    {
        term = term.Trim();
        term = term.ToLower();
        return term;
    }
}
