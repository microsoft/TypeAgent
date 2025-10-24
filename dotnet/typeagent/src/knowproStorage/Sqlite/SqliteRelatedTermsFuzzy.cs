// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


using System.Collections;
using TypeAgent.AIClient;

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteRelatedTermsFuzzy : ITermToRelatedTermsFuzzy
{
    SqliteDatabase _db;
    int _count = -1;

    public SqliteRelatedTermsFuzzy(SqliteDatabase db, TextEmbeddingIndexSettings settings)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        _db = db;
        Settings = settings;
    }

    public TextEmbeddingIndexSettings Settings { get; }

    public bool IsReadOnly => false;

    public NormalizedEmbedding this[int index] { get => throw new NotImplementedException(); set => throw new NotImplementedException(); }

    public int GetCount()
    {
        if (_count < 0)
        {
            _count = _db.GetCount(SqliteStorageProviderSchema.RelatedTermsFuzzyTable);
        }
        return _count;
    }

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public void AddTerm(string term, NormalizedEmbedding embedding)
    {
        using var cmd = _db.CreateCommand(@"
INSERT OR REPLACE INTO RelatedTermsFuzzy
(term, term_embedding)
VALUES(@term, @term_embedding)
    ");
        cmd.AddParameter("@term", term);
        cmd.AddParameter("@term_embedding", embedding.ToBytes());
        cmd.ExecuteNonQuery();
    }

    public void AddTerms(IEnumerable<KeyValuePair<string, NormalizedEmbedding>> rows)
    {
        ArgumentVerify.ThrowIfNull(rows, nameof(rows));
        foreach (var row in rows)
        {
            AddTerm(row.Key, row.Value);
        }
    }

    public async ValueTask AddTermsAsync(IList<string> terms, CancellationToken cancellationToken = default)
    {
        var embeddings = await Settings.EmbeddingModel.GenerateNormalizedInBatchesAsync(
            terms,
            Settings.MaxCharsPerBatch,
            Settings.BatchSize,
            Settings.Concurrency,
            cancellationToken
        );
        int count = terms.Count;
        for (int i = 0; i < count; ++i)
        {
            AddTerm(terms[i], embeddings[i]);
        }
    }

    public async ValueTask<IList<Term>> LookupTermAsync(
        string text,
        int? maxMatches,
        double? minScore,
        CancellationToken cancellationToken = default
    )
    {
        var embedding = await Settings.EmbeddingModel.GenerateNormalizedAsync(text, cancellationToken);
        List<ScoredItem<int>> termIds = GetAll().IndexesOfNearest(
            embedding,
            maxMatches is not null ? maxMatches.Value : Settings.MaxMatches,
            minScore is not null ? minScore.Value : Settings.MinScore
        );
        return GetTerms(termIds);
    }

    public ValueTask<IList<IList<Term>>> LookupTermAsync(IList<string> texts, int maxMatches, double minScore)
    {
        throw new NotImplementedException();
    }

    public IEnumerable<KeyValuePair<int, NormalizedEmbeddingB>> GetAll()
    {
        return _db.Enumerate<KeyValuePair<int, NormalizedEmbeddingB>>(
            "SELECT term_id, term_embedding FROM RelatedTermsFuzzy",
            reader =>
            {
                int iCol = 0;
                var term = reader.GetInt32(iCol++);
                var embeddingBytes = (byte[])reader.GetValue(iCol++);
                return new(term, new NormalizedEmbeddingB(embeddingBytes));
            });
    }

    private List<Term> GetTerms(List<ScoredItem<int>> termIds)
    {
        var placeholderIds = SqliteDatabase.MakeInPlaceholderIds(termIds.Count);

        var rows = _db.Enumerate(
            $@"
SELECT term
FROM RelatedTermsFuzzy WHERE term_id IN ({string.Join(", ", placeholderIds)})
ORDER BY term_id",
            (cmd) => cmd.AddIdParameters(placeholderIds, termIds.Map((t) => t.Item)),
            (reader) => reader.GetString(0)
        );
        int i = 0;
        List<Term> terms = new List<Term>(termIds.Count);
        foreach (var term in rows)
        {
            var scoredTermId = termIds[i];
            terms.Add(new Term(term, (float)termIds[i].Score));
        }
        return terms;
    }
}
