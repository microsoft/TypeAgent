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
    int _count = -1;

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
            _count = _db.GetCount(SqliteStorageProviderSchema.MessagesTable);
        }
        return _count;
    }

    public Task<int> GetCountAsync()
    {
        return Task.FromResult(GetCount());
    }

    public void Append(TMessage message)
    {
        message.ThrowIfInvalid();

        MessageRow messageRow = ToMessageRow(message);

        using var cmd = _db.CreateCommand(
           @"INSERT INTO Messages (msg_id, chunks, chunk_uri, start_timestamp, tags, metadata, extra)
          VALUES (@msg_id, @chunks, @chunk_uri, @start_timestamp, @tags, @metadata, @extra);"
        );
        WriteMessageRow(cmd, GetNextMessageId(), messageRow);
        int rowCount = cmd.ExecuteNonQuery();
        if (rowCount > 0)
        {
            _count += rowCount;
        }
    }

    public Task AppendAsync(TMessage message)
    {
        Append(message);
        return Task.CompletedTask;
    }

    public Task AppendAsync(IEnumerable<TMessage> messages)
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
        KnowProVerify.VerifyMessageOrdinal(msgId);

        using var cmd = _db.CreateCommand(@"
SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
FROM Messages WHERE msg_id = @msg_id"
        );
        cmd.Parameters.AddWithValue("@msg_id", msgId);

        using var reader = cmd.ExecuteReader();
        if (!reader.Read())
        {
            throw new ArgumentException($"No message at ordinal {msgId}");
        }

        MessageRow messageRow = ReadMessageRow(reader);
        TMessage message = FromMessageRow(messageRow);
        return message;
    }

    public Task<TMessage> GetAsync(int msgId)
    {
        TMessage message = Get(msgId);
        return Task.FromResult(message);
    }

    public Task<IList<TMessage>> GetAsync(IList<int> messageIds)
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
        while (await reader.ReadAsync(cancellationToken))
        {
            TMessage message = ReadMessage(reader);
            yield return message;
        }
    }

    public Task<IList<TMessage>> GetSliceAsync(int start, int end)
    {
        KnowProVerify.VerifyMessageOrdinal(start);
        KnowProVerify.VerifyMessageOrdinal(end);
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
        MessageRow row = new MessageRow();

        int iCol = 0;
        row.ChunksJson = reader.GetStringOrNull(iCol++);
        row.ChunkUri = reader.GetStringOrNull(iCol++);
        row.StartTimestamp = reader.GetStringOrNull(iCol++);
        row.TagsJson = reader.GetStringOrNull(iCol++);
        row.MetadataJson = reader.GetStringOrNull(iCol++);
        row.ExtraJson = reader.GetStringOrNull(iCol);

        return row;
    }

    void WriteMessageRow(SqliteCommand cmd, int messageId, MessageRow messageRow)
    {
        cmd.AddParameter("@msg_id", messageId);
        cmd.AddParameter("@chunks", messageRow.ChunksJson);
        cmd.AddParameter("@chunk_uri", messageRow.ChunkUri);
        cmd.AddParameter("@start_timestamp", messageRow.StartTimestamp);
        cmd.AddParameter("@tags", messageRow.TagsJson);
        cmd.AddParameter("@metadata", messageRow.MetadataJson);
        cmd.AddParameter("@extra", messageRow.ExtraJson);
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
}
