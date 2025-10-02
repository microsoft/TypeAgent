// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


using System.Text.Json.Nodes;

namespace TypeAgent.KnowPro.Storage.Sqlite;

/// <summary>
/// Schema is in SqliteStorageProviderSchema.cs
/// </summary>
/// <typeparam name="TMessage"></typeparam>
public class SqliteMessageCollection<TMessage, TMeta> : IMessageCollection<TMessage>
    where TMessage : class, IMessage, new()
    where TMeta : IMessageMetadata
{
    SqliteDatabase _db;
    private int _count = -1;

    public SqliteMessageCollection(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        _db = db;
    }

    public bool IsPersistent => true;

    public int GetCount()
    {
        if (_count < 0)
        {
            _count = MessagesTable.GetCount(_db);
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
        MessageRow messageRow = MessagesTable.GetMessage(_db, msgId);
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
        await foreach (var message in MessagesTable.GetAllMessagesAsync(_db, cancellationToken))
        {
            yield return FromMessageRow(message);
        }
    }

    public IList<TMessage> GetSlice(int startOrdinal, int endOrdinal)
    {
        return MessagesTable.GetSlice(_db, startOrdinal, endOrdinal).Map(FromMessageRow);
    }

    public Task<IList<TMessage>> GetSliceAsync(int startOrdinal, int endOrdinal, CancellationToken cancellationToken = default)
    {
        var messageList = GetSlice(startOrdinal, endOrdinal);
        return Task.FromResult(messageList);
    }

    int GetNextMessageId()
    {
        return GetCount();
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
    public static MessageRow ReadNew(SqliteDataReader reader)
    {
        return new MessageRow().Read(reader);
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

public class SqliteMessageCollection : IMessageCollection
{
    SqliteDatabase _db;
    Type _messageType;
    Type _metadataType;

    public SqliteMessageCollection(SqliteDatabase db, Type messageType, Type metadataType)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        _db = db;
        _messageType = messageType;
        _metadataType = metadataType;
    }

    public bool IsPersistent => true;

    public int GetCount() => MessagesTable.GetCount(_db);

    public Task<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(GetCount());
    }

    public IMessage Get(int msgId)
    {
        MessageRow messageRow = MessagesTable.GetMessage(_db, msgId);
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
        await foreach (var messageRow in MessagesTable.GetAllMessagesAsync(_db, cancellationToken))
        {
            IMessage message = FromMessageRow(messageRow);
            yield return message;
        }
    }

    public IList<IMessage> GetSlice(int startOrdinal, int endOrdinal)
    {
        return MessagesTable.GetSlice(_db, startOrdinal, endOrdinal).Map(FromMessageRow);
    }

    public Task<IList<IMessage>> GetSliceAsync(int startOrdinal, int endOrdinal, CancellationToken cancellationToken = default)
    {
        var messageList = GetSlice(startOrdinal, endOrdinal);
        return Task.FromResult(messageList);
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
}


internal static class MessagesTable
{
    public static int GetCount(SqliteDatabase db)
    {
        return db.GetCount(SqliteStorageProviderSchema.MessagesTable);
    }

    public static MessageRow GetMessage(SqliteDatabase db, int msgId)
    {
        KnowProVerify.ThrowIfInvalidMessageOrdinal(msgId);

        return db.Get(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages WHERE msg_id = @msg_id",
        (cmd) =>
        {
            cmd.AddParameter("@msg_id", msgId);
        },
        (reader) =>
        {
            return reader.Read() ?
                   ReadMessageRow(reader) :
                   throw new ArgumentException($"No message at ordinal {msgId}");
        }
        );
    }

    public static IAsyncEnumerable<MessageRow> GetAllMessagesAsync(SqliteDatabase db, CancellationToken cancellation = default)
    {
        return db.EnumerateAsync<MessageRow>(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages ORDER BY msg_id",
            ReadMessageRow,
            cancellation
        );
    }

    public static IEnumerable<MessageRow> GetSlice(SqliteDatabase db, int startOrdinal, int endOrdinal)
    {
        KnowProVerify.ThrowIfInvalidMessageOrdinal(startOrdinal);
        KnowProVerify.ThrowIfInvalidMessageOrdinal(endOrdinal);
        ArgumentVerify.ThrowIfGreaterThan(startOrdinal, endOrdinal, nameof(startOrdinal));

        return db.Enumerate(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages WHERE msg_id >= @start_id AND msg_id < @end_id
ORDER BY msg_id",
            (cmd) =>
            {
                cmd.AddParameter("@start_id", startOrdinal);
                cmd.AddParameter("@end_id", endOrdinal);
            },
            ReadMessageRow
        );
    }

    public static MessageRow ReadMessageRow(SqliteDataReader reader)
    {
        return new MessageRow().Read(reader);
    }

}
