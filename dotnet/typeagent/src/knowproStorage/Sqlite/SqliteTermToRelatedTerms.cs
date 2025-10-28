// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteTermToRelatedTerms : ITermsToRelatedTermsIndex
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

        float weight = relatedTerm.Weight is not null ? relatedTerm.Weight.Value : 1.0f;

        using var cmd = _db.CreateCommand(@"
INSERT OR IGNORE INTO RelatedTermsAliases (term, alias, score)
VALUES (@term, @alias, @score)"
);
        cmd.AddParameter("@term", text);
        cmd.AddParameter("@alias", relatedTerm.Text);
        cmd.AddParameter("@score", weight);
        cmd.ExecuteNonQuery();
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

    public IList<Term>? Lookup(string termText)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(termText, nameof(termText));

        using var cmd = _db.CreateCommand(@"
SELECT alias, score FROM RelatedTermsAliases WHERE term = @term"
);
        cmd.AddParameter("@term", termText);
        using var reader = cmd.ExecuteReader();
        return reader.GetListOrNull(
            (reader) => ReadTerm(reader)
        );
    }

    public IDictionary<string, IList<Term>>? Lookup(IList<string> termTexts)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(termTexts, nameof(termTexts));

        var placeholderIds = SqliteDatabase.MakeInPlaceholderParamIds(termTexts.Count);
        var rows = _db.Enumerate(
            $@"
SELECT term, alias, score
FROM  RelatedTermsAliases
WHERE term IN ({SqliteDatabase.MakeInStatement(placeholderIds)})
",
            (cmd) => cmd.AddPlaceholderParameters(placeholderIds, termTexts),
            (reader) =>
            {
                return new KeyValuePair<string, Term>(reader.GetString(0), ReadTerm(reader, 1));
            }
        );
        var results = new Multiset<string, Term>(rows);
        return !results.IsNullOrEmpty() ? (IDictionary<string, IList<Term>>)results : null;
    }

    public ValueTask<IList<Term>?> LookupTermAsync(string text, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(Lookup(text));
    }

    public ValueTask<IDictionary<string, IList<Term>>?> LookupTermAsync(IList<string> texts, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(Lookup(texts));
    }

    Term ReadTerm(SqliteDataReader reader, int iCol = 0)
    {
        return new Term(reader.GetString(iCol), reader.GetFloat(iCol));
    }
}
