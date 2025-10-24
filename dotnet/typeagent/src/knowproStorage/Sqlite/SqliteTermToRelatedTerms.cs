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

    public void AddRelatedTerm(string text, Term relatedTerm)
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
        cmd.ExecuteNonQuery();
    }

    public ValueTask AddRelatedTermAsync(string text, Term relatedTerm, CancellationToken cancellationToken = default)
    {
        AddRelatedTerm(text, relatedTerm);
        return ValueTask.CompletedTask;
    }

    public void AddRelatedTerms(string text, IList<Term> relatedTerms)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(relatedTerms, nameof(relatedTerms));

        // TODO: bulk operations
        foreach (var relatedTerm in relatedTerms)
        {
            AddRelatedTerm(text, relatedTerm);
        }
    }

    public ValueTask AddRelatedTermAsync(string text, IList<Term> relatedTerms, CancellationToken cancellationToken = default)
    {
        AddRelatedTerms(text, relatedTerms);
        return ValueTask.CompletedTask;
    }

    public void Clear() => _db.ClearTable(SqliteStorageProviderSchema.RelatedTermsAliases);

    public ValueTask ClearAsync(CancellationToken cancellationToken = default)
    {
        Clear();
        return ValueTask.CompletedTask;
    }

    public IList<Term>? LookupTerm(string text, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(text, nameof(text));

        return _db.GetList(@"
SELECT alias, score FROM RelatedTermsAliases WHERE term = @term",
            (reader) => new Term(reader.GetString(0), reader.GetFloat(1))
        );
    }

    public ValueTask<IList<Term>?> LookupTermAsync(string text, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(LookupTerm(text, cancellationToken));
    }
}
