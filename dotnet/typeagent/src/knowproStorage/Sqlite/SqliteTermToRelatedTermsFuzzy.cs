// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


using System.Collections;
using TypeAgent.AIClient;

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteTermToRelatedTermsFuzzy : ITermToRelatedTermsFuzzy, IReadOnlyCache<string, Embedding>
{
    SqliteDatabase _db;

    public SqliteTermToRelatedTermsFuzzy(SqliteDatabase db, TextEmbeddingIndexSettings settings)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        _db = db;
        Settings = settings;
    }

    public TextEmbeddingIndexSettings Settings { get; }

    public bool IsReadOnly => false;

    public event Action<BatchProgress> OnIndexed;

    public int GetCount() => _db.GetCount(SqliteStorageProviderSchema.RelatedTermsFuzzyTable);

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public bool TryGet(string key, out Embedding value)
    {
        using var cmd = _db.CreateCommand(@"
SELECT term_embedding from RelatedTermsFuzzy
WHERE term = @term 
");
        cmd.AddParameter("@term", key);
        using var reader = cmd.ExecuteReader();
        if (reader.Read())
        {
            value = reader.GetEmbedding(0);
            return true;
        }
        value = Embedding.Empty;
        return false;
    }

    public void AddTerm(string term, NormalizedEmbedding embedding)
    {
        using var cmd = _db.CreateCommand(@"
INSERT OR REPLACE INTO RelatedTermsFuzzy
(term, term_embedding)
VALUES(@term, @term_embedding)
    ");
        cmd.AddParameter("@term", term);
        cmd.AddParameter("@term_embedding", embedding);
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
        ArgumentVerify.ThrowIfNullOrEmpty(terms, nameof(terms));

        var embeddings = await Settings.EmbeddingModel.GenerateNormalizedInBatchesAsync(
            terms,
            Settings.BatchSize,
            Settings.MaxCharsPerBatch,
            Settings.Concurrency,
            OnIndexed is not null ? NotifyIndexed : null,
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
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(text, nameof(text));

        var embedding = await Settings.EmbeddingModel.GenerateNormalizedAsync(text, cancellationToken);
        return GetNearestTerms(embedding, maxMatches, minScore);
    }

    public async ValueTask<IList<IList<Term>>> LookupTermAsync(
        IList<string> texts,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(texts, nameof(texts));

        var embeddings = await Settings.EmbeddingModel.GenerateNormalizedAsync(texts, cancellationToken);
        // TODO: Bulk operation
        IList<IList<Term>> matches = [];
        foreach (var embedding in embeddings)
        {
            matches.Add(GetNearestTerms(embedding, maxMatches, minScore));
        }
        return matches;
    }

    public void Clear() => _db.ClearTable(SqliteStorageProviderSchema.RelatedTermsFuzzyTable);

    public ValueTask ClearAsync(CancellationToken cancellation = default)
    {
        Clear();
        return ValueTask.CompletedTask;
    }

    public IEnumerable<KeyValuePair<int, NormalizedEmbeddingB>> GetAll()
    {
        return _db.Enumerate<KeyValuePair<int, NormalizedEmbeddingB>>(
            "SELECT term_id, term_embedding FROM RelatedTermsFuzzy",
            reader =>
            {
                int iCol = 0;
                var term = reader.GetInt32(iCol++);
                var embedding = reader.GetNormalizedEmbedding(iCol++);
                return new(term, embedding);
            });
    }

    private List<ScoredItem<int>> IndexesOfNearest(
        NormalizedEmbedding embedding,
        int? maxMatches,
        double? minScore
    )
    {
        return GetAll().IndexesOfNearest(
            embedding,
            maxMatches is not null ? maxMatches.Value : Settings.MaxMatches,
            minScore is not null ? minScore.Value : Settings.MinScore
        );

    }

    private List<Term> GetNearestTerms(
        NormalizedEmbedding embedding,
        int? maxMatches,
        double? minScore
        )
    {
        var termIds = GetAll().IndexesOfNearest(
            embedding,
            maxMatches is not null ? maxMatches.Value : Settings.MaxMatches,
            minScore is not null ? minScore.Value : Settings.MinScore
        );
        return termIds.IsNullOrEmpty() ? [] : GetTerms(termIds);
    }


    private List<Term> GetTerms(List<ScoredItem<int>> termIds)
    {
        var placeholderIds = SqliteDatabase.MakeInPlaceholderParamIds(termIds.Count);

        var rows = _db.Enumerate(
            $@"
SELECT term
FROM RelatedTermsFuzzy WHERE term_id IN ({SqliteDatabase.MakeInStatement(placeholderIds)})
ORDER BY term_id",
            (cmd) => cmd.AddPlaceholderParameters(placeholderIds, termIds.Map((t) => t.Item)),
            (reader) => reader.GetString(0)
        );
        int i = 0;
        List<Term> terms = new List<Term>(termIds.Count);
        foreach (var term in rows)
        {
            var scoredTermId = termIds[i];
            terms.Add(new Term(term, (float)termIds[i].Score));
            ++i;
        }
        return terms;
    }

    private void NotifyIndexed(BatchProgress item)
    {
        // SafeInvoke Checks null, handles exceptions etc
        OnIndexed.SafeInvoke(item);
    }
}
