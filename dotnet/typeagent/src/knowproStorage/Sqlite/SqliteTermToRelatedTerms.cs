// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteTermToRelatedTerms : ITermsToRelatedTerms
{
    SqliteDatabase _db;

    public SqliteTermToRelatedTerms(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));

        _db = db;
    }

    public int GetCount() => _db.GetCount(SqliteStorageProviderSchema.RelatedTermsAliases);

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(GetCount());

    public List<string> GetTerms()
    {
        return _db.GetList(
            @"SELECT DISTINCT term from RelatedTermsAliases",
            (reader) => reader.GetString(0)
        );
    }

    public ValueTask<IList<string>> GetTermsAsync(CancellationToken cancellationToken = default)
    {
        IList<string> terms = GetTerms();
        return ValueTask.FromResult(terms);
    }

    public void AddTerm(string text, Term relatedTerm)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(text, nameof(text));

        KnowProVerify.ThrowIfInvalid(relatedTerm);

        using var cmd = _db.CreateCommand(@"
INSERT OR IGNORE INTO RelatedTermsAliases (term, alias, score)
VALUES (@term, @alias, @score)"
);
        cmd.AddParameter("@term", text);
        cmd.AddParameter("@alias", relatedTerm.Text);
        cmd.AddParameter("@score", relatedTerm.Weight);
        int result = cmd.ExecuteNonQuery();
        Console.WriteLine(result);
    }

    public ValueTask AddTermAsync(string text, Term relatedTerm, CancellationToken cancellationToken = default)
    {
        AddTerm(text, relatedTerm);
        return ValueTask.CompletedTask;
    }

    public void AddTerm(string text, IList<Term> relatedTerms)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(relatedTerms, nameof(relatedTerms));

        // TODO: bulk operations
        foreach (var relatedTerm in relatedTerms)
        {
            AddTerm(text, relatedTerm);
        }
    }

    public ValueTask AddTermAsync(string text, IList<Term> relatedTerms, CancellationToken cancellationToken = default)
    {
        AddTerm(text, relatedTerms);
        return ValueTask.CompletedTask;
    }

    public void Clear() => _db.ClearTable(SqliteStorageProviderSchema.RelatedTermsAliases);

    public ValueTask ClearAsync(CancellationToken cancellationToken = default)
    {
        Clear();
        return ValueTask.CompletedTask;
    }

    public IList<Term>? Lookup(string term, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(term, nameof(term));

        using var cmd = _db.CreateCommand(@"
SELECT alias, score FROM RelatedTermsAliases WHERE term = @term"
);
        cmd.AddParameter("@term", term);
        using var reader = cmd.ExecuteReader();
        return reader.GetListOrNull(
            (reader) => new Term(reader.GetString(0), reader.GetFloat(1))
        );
    }

    public ValueTask<IList<Term>?> LookupTermAsync(string text, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(Lookup(text, cancellationToken));
    }
}
