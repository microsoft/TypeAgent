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

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public void Append(TMessage message)
    {
        KnowProVerify.ThrowIfInvalid(message);

        MessageRow messageRow = ToMessageRow(message);

        using var cmd = _db.CreateCommand(
           @"INSERT INTO Messages (msg_id, chunks, chunk_uri, message_length, start_timestamp, tags, metadata, extra)
          VALUES (@msg_id, @chunks, @chunk_uri, @message_length, @start_timestamp, @tags, @metadata, @extra);"
        );
        messageRow.Write(cmd, GetNextMessageId());

        int rowCount = cmd.ExecuteNonQuery();
        if (rowCount > 0)
        {
            _count += rowCount;
        }
    }

    public ValueTask AppendAsync(TMessage message, CancellationToken cancellationToken = default)
    {
        Append(message);
        return ValueTask.CompletedTask;
    }

    public ValueTask AppendAsync(IEnumerable<TMessage> messages, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNull(messages, nameof(messages));

        // TODO: Bulk operations
        foreach (var message in messages)
        {
            Append(message);
        }
        return ValueTask.CompletedTask;
    }

    public TMessage Get(int msgId)
    {
        MessageRow messageRow = MessagesTable.GetMessage(_db, msgId);
        TMessage message = FromMessageRow(messageRow);
        return message;
    }

    public ValueTask<TMessage> GetAsync(int msgId, CancellationToken cancellationToken = default)
    {
        TMessage message = Get(msgId);
        return ValueTask.FromResult(message);
    }

    public ValueTask<IList<TMessage>> GetAsync(IList<int> messageIds, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messageIds, nameof(messageIds));

        /*
        // TODO: Bulk operations
        IList<TMessage> messages = [];
        foreach (int msgId in messageIds)
        {
            messages.Add(Get(msgId));
        }
        */
        List<TMessage> messages = new List<TMessage>(messageIds.Count);
        foreach (var messageRow in MessagesTable.GetMessages(_db, messageIds))
        {
            messages.Add(FromMessageRow(messageRow));
        }
        return ValueTask.FromResult((IList<TMessage>)messages);
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

    public ValueTask<IList<TMessage>> GetSliceAsync(int startOrdinal, int endOrdinal, CancellationToken cancellationToken = default)
    {
        var messageList = GetSlice(startOrdinal, endOrdinal);
        return ValueTask.FromResult(messageList);
    }

    public int GetMessageLength(int messageOrdinal) => MessagesTable.GetMessageLength(_db, messageOrdinal);

    public ValueTask<int> GetMessageLengthAsync(int messageOrdinal, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetMessageLength(messageOrdinal));
    }

    public IEnumerable<int> GetMessageLengths(IList<int> messageOrdinals) => MessagesTable.GetMessageLengths(_db, messageOrdinals);

    public ValueTask<IList<int>> GetMessageLengthsAsync(IList<int> messageOrdinals, CancellationToken cancellationToken = default)
    {
        IList<int> lengths = [.. GetMessageLengths(messageOrdinals)];
        return ValueTask.FromResult(lengths);
    }

    int GetNextMessageId()
    {
        return GetCount();
    }

    MessageRow ToMessageRow(TMessage message)
    {
        if (message.TextChunks.IsNullOrEmpty())
        {
            throw new NotImplementedException("message.TextChunks must be provided");
        }

        MessageRow messageRow = new();

        messageRow.ChunksJson = StorageSerializer.ToJson(message.TextChunks);
        messageRow.ChunkUri = null;
        messageRow.MessageLength = message.GetLength();
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
    public int MessageLength { get; set; }
    public string? StartTimestamp { get; set; }
    public string? TagsJson { get; set; }
    public string? MetadataJson { get; set; }
    public string? ExtraJson { get; set; }

    public MessageRow Read(SqliteDataReader reader)
    {
        int iCol = 0;
        ChunksJson = reader.GetStringOrNull(iCol++);
        ChunkUri = reader.GetStringOrNull(iCol++);
        MessageLength = reader.GetInt32(iCol++);
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
        cmd.AddParameter("@message_length", MessageLength);
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

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public IMessage Get(int msgId)
    {
        MessageRow messageRow = MessagesTable.GetMessage(_db, msgId);
        IMessage message = FromMessageRow(messageRow);
        return message;
    }

    public ValueTask<IMessage> GetAsync(int msgId, CancellationToken cancellationToken = default)
    {
        IMessage message = Get(msgId);
        return ValueTask.FromResult(message);
    }

    public ValueTask<IList<IMessage>> GetAsync(IList<int> messageIds, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messageIds, nameof(messageIds));

        /*
        IList<IMessage> messages = [];
        foreach (int msgId in messageIds)
        {
            messages.Add(Get(msgId));
        }
        */
        List<IMessage> messages = new List<IMessage>(messageIds.Count);
        foreach (var messageRow in MessagesTable.GetMessages(_db, messageIds))
        {
            messages.Add(FromMessageRow(messageRow));
        }
        return ValueTask.FromResult((IList<IMessage>)messages);
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

    public ValueTask<IList<IMessage>> GetSliceAsync(int startOrdinal, int endOrdinal, CancellationToken cancellationToken = default)
    {
        var messageList = GetSlice(startOrdinal, endOrdinal);
        return ValueTask.FromResult(messageList);
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

    public int GetMessageLength(int messageOrdinal) => MessagesTable.GetMessageLength(_db, messageOrdinal);

    public ValueTask<int> GetMessageLengthAsync(int messageOrdinal, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetMessageLength(messageOrdinal));
    }

    public IEnumerable<int> GetMessageLengths(IList<int> messageOrdinals) => MessagesTable.GetMessageLengths(_db, messageOrdinals);

    public ValueTask<IList<int>> GetMessageLengthsAsync(IList<int> messageOrdinals, CancellationToken cancellationToken = default)
    {
        IList<int> lengths = [.. GetMessageLengths(messageOrdinals)];
        return ValueTask.FromResult(lengths);
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

    public static IEnumerable<MessageRow> GetMessages(SqliteDatabase db, IList<int> messageIds)
    {
        foreach (var batch in messageIds.Batch(SqliteDatabase.MaxBatchSize))
        {
            var placeholderIds = SqliteDatabase.MakeInPlaceholderIds(batch.Count);

            var rows = db.Enumerate(
                $@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages WHERE msg_id IN ({string.Join(", ", placeholderIds)})
ORDER BY msg_id",
                (cmd) => cmd.AddIdParameters(placeholderIds, batch),
                ReadMessageRow
            );
            foreach (var row in rows)
            {
                yield return row;
            }
        }
    }

    public static int GetMessageLength(SqliteDatabase db, int msgId)
    {
        KnowProVerify.ThrowIfInvalidMessageOrdinal(msgId);

        return db.Get(@"
SELECT message_length
FROM Messages WHERE msg_id = @msg_id",
            (cmd) =>
            {
                cmd.AddParameter("@msg_id", msgId);
            },
            (reader) => reader.GetInt32(0)
        );
    }

    public static IEnumerable<int> GetMessageLengths(SqliteDatabase db, IList<int> messageIds)
    {
        foreach (var batch in messageIds.Batch(SqliteDatabase.MaxBatchSize))
        {
            var placeholderIds = SqliteDatabase.MakeInPlaceholderIds(batch.Count);

            var lengths = db.Enumerate(
                $@"
SELECT message_length
FROM Messages WHERE msg_id IN ({string.Join(", ", placeholderIds)})
ORDER BY msg_id",
                (cmd) => cmd.AddIdParameters(placeholderIds, batch),
                (reader) => reader.GetInt32(0)
            );
            foreach (var length in lengths)
            {
                yield return length;
            }
        }
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
