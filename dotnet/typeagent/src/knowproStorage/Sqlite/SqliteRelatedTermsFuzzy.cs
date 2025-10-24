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

    public async ValueTask AddTermsAsync(IList<string> terms)
    {
        var embeddings = await Settings.EmbeddingModel.GenerateInBatchesAsync(
            terms,
            Settings.MaxCharsPerBatch,
            Settings.BatchSize
        );
        int count = terms.Count;
        for (int i = 0; i < count; ++i)
        {
            Embedding embedding = embeddings[i];
            embedding.NormalizeInPlace();
            AddTerm(terms[i], new NormalizedEmbedding(embedding));
        }
    }

    public ValueTask<IList<Term>> LookupTermAsync(string text, int maxMatches, double minScore)
    {
        throw new NotImplementedException();
    }

    public ValueTask<IList<IList<Term>>> LookupTermAsync(IList<string> texts, int maxMatches, double minScore)
    {
        throw new NotImplementedException();
    }

    public IEnumerable<KeyValuePair<string, NormalizedEmbeddingB>> GetAll()
    {
        return _db.Enumerate<KeyValuePair<string, NormalizedEmbeddingB>>(
            "SELECT term, term_embedding FROM RelatedTermsFuzzy",
            reader =>
            {
                int iCol = 0;
                var term = reader.GetString(iCol++);
                var embeddingBytes = (byte[])reader.GetValue(iCol++);
                return new(term, new NormalizedEmbeddingB(embeddingBytes));
            });
    }
}
