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

    public int GetCount() => _db.GetCount(SqliteStorageProviderSchema.MessageTextIndexTableName);

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public async ValueTask AddMessageAsync(IMessage message, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNull(message, nameof(message));
        if (message.TextChunks.IsNullOrEmpty())
        {
            return;
        }

        int messageOrdinal = GetNextMessageOrdinal();
        var embeddings = await Settings.EmbeddingModel.GenerateNormalizedInBatchesAsync(
            message.TextChunks,
            Settings.BatchSize,
            Settings.MaxCharsPerBatch,
            Settings.Concurrency,
            null,
            cancellationToken
        ).ConfigureAwait(false);

        using var cmd = CreateInsertCommand();
        Insert(cmd, messageOrdinal, embeddings);
    }

    public async ValueTask AddMessagesAsync(IList<IMessage> messages, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messages, nameof(messages));

        // TODO: Bulk
        foreach (var message in messages)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await AddMessageAsync(message, cancellationToken).ConfigureAwait(false);
        }
    }

    public ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesAsync(string messageText, int? maxMatches = null, double? thresholdScore = null, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesInSubsetAsync(string messageText, IEnumerable<int> ordinalsToSearch, int? maxMatches = null, double? thresholdScore = null, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    private void Insert(SqliteCommand cmd, int messageOrdinal, List<NormalizedEmbedding> embeddings)
    {
        int count = embeddings.Count;
        for (int i = 0; i < count; ++i)
        {
            cmd.Parameters.Clear();
            cmd.AddParameter("@msg_id", messageOrdinal);
            cmd.AddParameter("@chunk_ordinal", i);
            cmd.AddParameter("@embedding", embeddings[i]);
            cmd.ExecuteNonQuery();
        }
    }

    public IEnumerable<KeyValuePair<int, NormalizedEmbeddingB>> GetAll()
    {
        return _db.EnumerateEmbeddings(
"SELECT msg_id, embedding FROM MessageTextIndex"
        );
    }

    private SqliteCommand CreateInsertCommand()
    {
        return _db.CreateCommand(@"
INSERT INTO MessageTextIndex (msg_id, chunk_ordinal, embedding)
VALUES (@msg_id, @chunk_ordinal, @embedding)");
    }

    private int GetNextMessageOrdinal() => GetMaxMessageOrdinal() + 1;

    private int GetMaxMessageOrdinal()
    {
        return _db.Get(
            "SELECT MAX(msg_id) FROM MessageTextIndex",
            null,
            (reader) => reader.GetInt32(0)
        );
    }
}
