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

    public void Add(string text, Term relatedTerm)
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

    public ValueTask AddAsync(string text, Term relatedTerm, CancellationToken cancellationToken = default)
    {
        Add(text, relatedTerm);
        return ValueTask.CompletedTask;
    }

    public void Add(string text, IList<Term> relatedTerms)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(relatedTerms, nameof(relatedTerms));

        // TODO: bulk operations
        foreach (var relatedTerm in relatedTerms)
        {
            Add(text, relatedTerm);
        }
    }

    public ValueTask AddAsync(string text, IList<Term> relatedTerms, CancellationToken cancellationToken = default)
    {
        Add(text, relatedTerms);
        return ValueTask.CompletedTask;
    }

    public void Clear() => _db.ClearTable(SqliteStorageProviderSchema.RelatedTermsAliases);

    public ValueTask ClearAsync(CancellationToken cancellationToken = default)
    {
        Clear();
        return ValueTask.CompletedTask;
    }

    public IList<Term>? Lookup(string text, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(text, nameof(text));

        return _db.GetList(@"
SELECT alias, score FROM RelatedTermsAliases WHERE term = @term",
            (reader) => new Term(reader.GetString(0), reader.GetFloat(1))
        );
    }

    public ValueTask<IList<Term>?> LookupAsync(string text, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(Lookup(text, cancellationToken));
    }
}
