// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


using System.Text.Json.Nodes;

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteMessageCollectionBase
{
    internal SqliteDatabase _db;

    internal SqliteMessageCollectionBase(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        _db = db;
    }

    internal SqliteCommand CreateGetCommand(int msgId)
    {
        KnowProVerify.ThrowIfInvalidMessageOrdinal(msgId);

        var cmd = _db.CreateCommand(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages WHERE msg_id = @msg_id"
        );
        cmd.Parameters.AddWithValue("@msg_id", msgId);
        return cmd;
    }

}

/// <summary>
/// Schema is in SqliteStorageProviderSchema.cs
/// </summary>
/// <typeparam name="TMessage"></typeparam>
public class SqliteMessageCollection<TMessage, TMeta> :
    SqliteMessageCollectionBase,
    IMessageCollection<TMessage>
    where TMessage : class, IMessage, new()
    where TMeta : IMessageMetadata
{
    private int _count = -1;

    public SqliteMessageCollection(SqliteDatabase db)
        : base(db)
    {
    }

    public bool IsPersistent => true;

    public int GetCount()
    {
        if (_count < 0)
        {
            _count = _db.GetCount(SqliteStorageProviderSchema.MessagesTable);
        }
        return _count;
    }

    public Task<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(GetCount());
    }

    public void Append(TMessage message)
    {
        KnowProVerify.ThrowIfInvalid(message);

        MessageRow messageRow = ToMessageRow(message);

        using var cmd = _db.CreateCommand(
           @"INSERT INTO Messages (msg_id, chunks, chunk_uri, start_timestamp, tags, metadata, extra)
          VALUES (@msg_id, @chunks, @chunk_uri, @start_timestamp, @tags, @metadata, @extra);"
        );
        messageRow.Write(cmd, GetNextMessageId());

        int rowCount = cmd.ExecuteNonQuery();
        if (rowCount > 0)
        {
            _count += rowCount;
        }
    }

    public Task AppendAsync(TMessage message, CancellationToken cancellationToken = default)
    {
        Append(message);
        return Task.CompletedTask;
    }

    public Task AppendAsync(IEnumerable<TMessage> messages, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNull(messages, nameof(messages));

        // TODO: Bulk operations
        foreach (var message in messages)
        {
            Append(message);
        }
        return Task.CompletedTask;
    }

    public TMessage Get(int msgId)
    {
        using var cmd = CreateGetCommand(msgId);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read())
        {
            throw new ArgumentException($"No message at ordinal {msgId}");
        }

        MessageRow messageRow = ReadMessageRow(reader);
        TMessage message = FromMessageRow(messageRow);
        return message;
    }

    public Task<TMessage> GetAsync(int msgId, CancellationToken cancellationToken = default)
    {
        TMessage message = Get(msgId);
        return Task.FromResult(message);
    }

    public Task<IList<TMessage>> GetAsync(IList<int> messageIds, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messageIds, nameof(messageIds));

        // TODO: Bulk operations
        IList<TMessage> messages = [];
        foreach (int msgId in messageIds)
        {
            messages.Add(Get(msgId));
        }
        return Task.FromResult(messages);
    }

    public async IAsyncEnumerator<TMessage> GetAsyncEnumerator(CancellationToken cancellationToken = default)
    {
        using var cmd = _db.CreateCommand(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages ORDER BY msg_id");
        using var reader = cmd.ExecuteReader();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            TMessage message = ReadMessage(reader);
            yield return message;
        }
    }

    public Task<IList<TMessage>> GetSliceAsync(int start, int end, CancellationToken cancellationToken = default)
    {
        KnowProVerify.ThrowIfInvalidMessageOrdinal(start);
        KnowProVerify.ThrowIfInvalidMessageOrdinal(end);
        ArgumentVerify.ThrowIfGreaterThan(start, end, nameof(start));

        using var cmd = _db.CreateCommand(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages WHERE msg_id >= @start_id AND msg_id < @end_id
ORDER BY msg_id");
        using var reader = cmd.ExecuteReader();
        var messageList = reader.GetList(ReadMessage);
        return Task.FromResult(messageList);
    }

    int GetNextMessageId()
    {
        return GetCount();
    }

    TMessage ReadMessage(SqliteDataReader reader)
    {
        MessageRow messageRow = ReadMessageRow(reader);
        return FromMessageRow(messageRow);
    }

    MessageRow ToMessageRow(TMessage message)
    {
        MessageRow messageRow = new();

        messageRow.ChunksJson = StorageSerializer.ToJson(message.TextChunks);
        messageRow.ChunkUri = null;
        messageRow.StartTimestamp = message.Timestamp;
        messageRow.TagsJson = StorageSerializer.ToJson(message.Tags);
        messageRow.MetadataJson = StorageSerializer.ToJson((TMeta)message.Metadata);
        // Also capture any extra data on the message
        messageRow.ExtraJson = (message is IMessageEx messageEx) ?
                               messageEx.SerializeExtraDataToJson() :
                               null;
        return messageRow;
    }

    TMessage FromMessageRow(MessageRow messageRow)
    {
        TMessage message = new TMessage();

        message.TextChunks = StorageSerializer.FromJsonArray<string>(messageRow.ChunksJson);
        message.Tags = StorageSerializer.FromJsonArray<string>(messageRow.TagsJson);
        message.Timestamp = messageRow.StartTimestamp;
        message.Metadata = StorageSerializer.FromJson<TMeta>(messageRow.MetadataJson);

        // Set extra fields if any (only works for public settable properties)
        if (messageRow.ExtraJson is not null && message is IMessageEx messageEx)
        {
            messageEx.DeserializeExtraDataFromJson(messageRow.ExtraJson);
        }

        return message;
    }

    MessageRow ReadMessageRow(SqliteDataReader reader)
    {
        return new MessageRow().Read(reader);
    }
}

internal class MessageRow
{
    public string? ChunksJson { get; set; }
    public string? ChunkUri { get; set; }
    public string? StartTimestamp { get; set; }
    public string? TagsJson { get; set; }
    public string? MetadataJson { get; set; }
    public string? ExtraJson { get; set; }

    public MessageRow Read(SqliteDataReader reader)
    {
        int iCol = 0;
        ChunksJson = reader.GetStringOrNull(iCol++);
        ChunkUri = reader.GetStringOrNull(iCol++);
        StartTimestamp = reader.GetStringOrNull(iCol++);
        TagsJson = reader.GetStringOrNull(iCol++);
        MetadataJson = reader.GetStringOrNull(iCol++);
        ExtraJson = reader.GetStringOrNull(iCol);

        return this;
    }

    public void Write(SqliteCommand cmd, int messageId)
    {
        cmd.AddParameter("@msg_id", messageId);
        cmd.AddParameter("@chunks", ChunksJson);
        cmd.AddParameter("@chunk_uri", ChunkUri);
        cmd.AddParameter("@start_timestamp", StartTimestamp);
        cmd.AddParameter("@tags", TagsJson);
        cmd.AddParameter("@metadata", MetadataJson);
        cmd.AddParameter("@extra", ExtraJson);
    }
}

public class SqliteMessageCollection : SqliteMessageCollectionBase, IReadOnlyMessageCollection
{
    Type _messageType;
    Type _metadataType;

    public SqliteMessageCollection(SqliteDatabase db, Type messageType, Type metadataType)
        : base(db)
    {
        _messageType = messageType;
        _metadataType = metadataType;
    }

    public bool IsPersistent => true;

    public int GetCount()
    {
        return _db.GetCount(SqliteStorageProviderSchema.MessagesTable);
    }

    public Task<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(GetCount());
    }

    public IMessage Get(int msgId)
    {
        using var cmd = CreateGetCommand(msgId);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read())
        {
            throw new ArgumentException($"No message at ordinal {msgId}");
        }

        MessageRow messageRow = ReadMessageRow(reader);
        IMessage message = FromMessageRow(messageRow);
        return message;
    }

    public Task<IMessage> GetAsync(int msgId, CancellationToken cancellationToken = default)
    {
        IMessage message = Get(msgId);
        return Task.FromResult(message);
    }

    public Task<IList<IMessage>> GetAsync(IList<int> messageIds, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messageIds, nameof(messageIds));

        // TODO: Bulk operations
        IList<IMessage> messages = [];
        foreach (int msgId in messageIds)
        {
            messages.Add(Get(msgId));
        }
        return Task.FromResult(messages);
    }

    public async IAsyncEnumerator<IMessage> GetAsyncEnumerator(CancellationToken cancellationToken = default)
    {
        using var cmd = _db.CreateCommand(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages ORDER BY msg_id");
        using var reader = cmd.ExecuteReader();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            IMessage message = ReadMessage(reader);
            yield return message;
        }
    }

    public Task<IList<IMessage>> GetSliceAsync(int start, int end, CancellationToken cancellationToken = default)
    {
        KnowProVerify.ThrowIfInvalidMessageOrdinal(start);
        KnowProVerify.ThrowIfInvalidMessageOrdinal(end);
        ArgumentVerify.ThrowIfGreaterThan(start, end, nameof(start));

        using var cmd = _db.CreateCommand(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages WHERE msg_id >= @start_id AND msg_id < @end_id
ORDER BY msg_id");
        using var reader = cmd.ExecuteReader();
        var messageList = reader.GetList(ReadMessage);
        return Task.FromResult(messageList);
    }

    int GetNextMessageId()
    {
        return GetCount();
    }

    IMessage ReadMessage(SqliteDataReader reader)
    {
        MessageRow messageRow = ReadMessageRow(reader);
        return FromMessageRow(messageRow);
    }

    IMessage FromMessageRow(MessageRow messageRow)
    {
        IMessage message = (IMessage)Activator.CreateInstance(_messageType);

        message.TextChunks = StorageSerializer.FromJsonArray<string>(messageRow.ChunksJson);
        message.Tags = StorageSerializer.FromJsonArray<string>(messageRow.TagsJson);
        message.Timestamp = messageRow.StartTimestamp;
        message.Metadata = (IMessageMetadata)StorageSerializer.FromJson(messageRow.MetadataJson, _metadataType);

        // Set extra fields if any (only works for public settable properties)
        if (messageRow.ExtraJson is not null && message is IMessageEx messageEx)
        {
            messageEx.DeserializeExtraDataFromJson(messageRow.ExtraJson);
        }

        return message;
    }

    MessageRow ReadMessageRow(SqliteDataReader reader)
    {
        return new MessageRow().Read(reader);
    }
}
