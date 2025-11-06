// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteMessageTextIndex : IMessageTextIndex
{
    private SqliteDatabase _db;

    public SqliteMessageTextIndex(SqliteDatabase db, TextEmbeddingIndexSettings settings)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        _db = db;
        Settings = settings;
    }

    public TextEmbeddingIndexSettings Settings { get; }

    public event Action<BatchProgress> OnIndexed;

    public int GetCount() => _db.GetCount(SqliteStorageProviderSchema.MessageTextIndexTableName);

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public async ValueTask AddMessageAsync(
        IMessage message,
        int messageOrdinal,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(message, nameof(message));
        if (message.TextChunks.IsNullOrEmpty())
        {
            return;
        }

        var embeddings = await Settings.EmbeddingModel.GenerateNormalizedInBatchesAsync(
            message.TextChunks,
            Settings.BatchSize,
            Settings.MaxCharsPerBatch,
            Settings.Concurrency,
            OnIndexed is not null ? NotifyIndexed : null,
            cancellationToken
        ).ConfigureAwait(false);

        using var cmd = CreateInsertCommand();
        Insert(cmd, messageOrdinal, embeddings);
    }

    public async ValueTask AddMessagesAsync(
        IList<IMessage> messages,
        int baseMessageOrdinal,
        CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messages, nameof(messages));
        //
        // Parallelize across all chunks
        //
        var (ordinals, chunks) = messages.FlattenChunks();
        var embeddings = await Settings.EmbeddingModel.GenerateNormalizedInBatchesAsync(
            chunks,
            Settings.BatchSize,
            Settings.MaxCharsPerBatch,
            Settings.Concurrency,
            OnIndexed is not null ? NotifyIndexed : null,
            cancellationToken
        ).ConfigureAwait(false);

        using var cmd = CreateInsertCommand();
        int count = embeddings.Count;
        for (int i = 0; i < count; ++i)
        {
            Insert(
                cmd,
                baseMessageOrdinal + ordinals[i].MessageOrdinal,
                ordinals[i].ChunkOrdinal,
                embeddings[i]
            );
        }
    }

    public async ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesAsync(
        string messageText,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messageText, nameof(messageText));

        var embedding = await Settings.EmbeddingModel.GenerateNormalizedAsync(
            messageText,
            cancellationToken
        ).ConfigureAwait(false);

        var matches = GetAll().KeysOfNearest(
            embedding,
            maxMatches is not null ? maxMatches.Value : Settings.MaxMatches,
            minScore is not null ? minScore.Value : Settings.MinScore
        );
        return matches.IsNullOrEmpty() ? [] : ToScoredOrdinals(matches);
    }

    public async ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesInSubsetAsync(
        string messageText,
        IList<int> ordinalsToSearch,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default
    )
    {
        var embedding = await Settings.EmbeddingModel.GenerateNormalizedAsync(
            messageText,
            cancellationToken
        ).ConfigureAwait(false);

        var matches = GetSubset(ordinalsToSearch).KeysOfNearest(
            embedding,
            maxMatches is not null ? maxMatches.Value : Settings.MaxMatches,
            minScore is not null ? minScore.Value : Settings.MinScore
        );
        return matches.IsNullOrEmpty() ? [] : ToScoredOrdinals(matches);
    }

    public async ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesAsync(
        string messageText,
        Func<int, bool> filter,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messageText, nameof(messageText));

        var embedding = await Settings.EmbeddingModel.GenerateNormalizedAsync(
            messageText,
            cancellationToken
        ).ConfigureAwait(false);

        var matches = GetAll().KeysOfNearest(
            embedding,
            maxMatches is not null ? maxMatches.Value : Settings.MaxMatches,
            minScore is not null ? minScore.Value : Settings.MinScore,
            filter
        );
        return matches.IsNullOrEmpty() ? [] : ToScoredOrdinals(matches);
    }

    public async ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesInSubsetAsync(
        string messageText,
        Func<int, bool> filter,
        IList<int> ordinalsToSearch,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default
    )
    {
        var embedding = await Settings.EmbeddingModel.GenerateNormalizedAsync(
            messageText,
            cancellationToken
        ).ConfigureAwait(false);

        var matches = GetSubset(ordinalsToSearch).KeysOfNearest(
            embedding,
            maxMatches is not null ? maxMatches.Value : Settings.MaxMatches,
            minScore is not null ? minScore.Value : Settings.MinScore,
            filter
        );
        return matches.IsNullOrEmpty() ? [] : ToScoredOrdinals(matches);
    }

    private void Insert(SqliteCommand cmd, int messageOrdinal, int chunkOrdinal, NormalizedEmbedding embedding)
    {
        cmd.Parameters.Clear();
        cmd.AddParameter("@msg_id", messageOrdinal);
        cmd.AddParameter("@chunk_ordinal", chunkOrdinal);
        cmd.AddParameter("@embedding", embedding);
        cmd.ExecuteNonQuery();
    }

    private void Insert(SqliteCommand cmd, int messageOrdinal, List<NormalizedEmbedding> embeddings)
    {
        int count = embeddings.Count;
        for (int chunkOrdinal = 0; chunkOrdinal < count; ++chunkOrdinal)
        {
            Insert(cmd, messageOrdinal, chunkOrdinal, embeddings[chunkOrdinal]);
        }
    }

    public IEnumerable<KeyValuePair<int, NormalizedEmbeddingB>> GetAll()
    {
        return _db.EnumerateEmbeddings(
"SELECT msg_id, embedding FROM MessageTextIndex"
        );
    }

    public IEnumerable<KeyValuePair<int, NormalizedEmbeddingB>> GetSubset(IList<int> messageOrdinals)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messageOrdinals, nameof(messageOrdinals));

        foreach (IList<int> batch in messageOrdinals.Batch(SqliteDatabase.MaxBatchSize))
        {
            string[] placeholderIds = SqliteDatabase.MakeInPlaceholderParamIds(batch.Count);
            var rows = _db.Enumerate(
                $@"
SELECT msg_id, embedding
FROM MessageTextIndex WHERE msg_id IN ({SqliteDatabase.MakeInStatement(placeholderIds)})
ORDER BY msg_id",
                (cmd) => cmd.AddPlaceholderParameters(placeholderIds, batch),
                reader => new KeyValuePair<int, NormalizedEmbeddingB>(reader.GetInt32(0), reader.GetNormalizedEmbedding(1))
            );
            foreach (var row in rows)
            {
                yield return row;
            }
        }
    }

    public ValueTask ClearAsync(CancellationToken cancellationToken = default)
    {
        _db.ClearTable(SqliteStorageProviderSchema.MessageTextIndexTableName);
        return ValueTask.CompletedTask;
    }

    public ValueTask<int?> GetMaxOrdinalAsync(CancellationToken cancellationToken = default)
    {
        int? maxId = _db.Get(
            "SELECT MAX(msg_id) from MessageTextIndex",
            null,
            (reader) => reader.GetIntOrNull(0)
        );

        return ValueTask.FromResult(maxId);
    }

    private SqliteCommand CreateInsertCommand()
    {
        return _db.CreateCommand(@"
INSERT INTO MessageTextIndex (msg_id, chunk_ordinal, embedding)
VALUES (@msg_id, @chunk_ordinal, @embedding)");
    }

    // TODO: get rid of this conversion
    private List<ScoredMessageOrdinal> ToScoredOrdinals(List<Scored<int>> items)
    {
        return items.Map((s) => new ScoredMessageOrdinal { MessageOrdinal = s.Item, Score = s.Score });
    }

    private void NotifyIndexed(BatchProgress item)
    {
        // SafeInvoke Checks null, handles exceptions etc
        OnIndexed.SafeInvoke(item);
    }

}
