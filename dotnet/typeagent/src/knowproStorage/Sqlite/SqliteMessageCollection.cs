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

    public SqliteMessageCollection(SqliteDatabase database)
    {
        ArgumentVerify.ThrowIfNull(database, nameof(database));
        _db = database;
    }

    public bool IsPersistent => true;

    public Task<int> GetCountAsync()
    {
        return Task.FromResult(GetCount());
    }

    public Task AppendAsync(TMessage message)
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
        return Task.FromResult(rowCount);
    }

    public Task AppendAsync(IEnumerable<TMessage> items)
    {
        throw new NotImplementedException();
    }

    public Task<TMessage> GetAsync(int msgId)
    {
        using var cmd = _db.CreateCommand(
            @"SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
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
        return Task.FromResult(message);
    }

    public Task<IList<TMessage>> GetAsync(IList<int> ordinals)
    {
        throw new NotImplementedException();
    }

    public IAsyncEnumerator<TMessage> GetAsyncEnumerator(CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IList<TMessage>> GetSliceAsync(int start, int end)
    {
        throw new NotImplementedException();
    }

    int GetNextMessageId()
    {
        return GetCount();
    }

    int GetCount()
    {
        if (_count < 0)
        {
            _count = _db.GetCount(SqliteStorageProviderSchema.MessagesTable);
        }
        return _count;
    }

    MessageRow ToMessageRow(TMessage message)
    {
        MessageRow messageRow = new();

        messageRow.ChunksJson = StorageSerializer.SerializeList<string>(message.TextChunks);
        messageRow.ChunkUri = null;
        messageRow.StartTimestamp = message.Timestamp;
        messageRow.TagsJson = StorageSerializer.SerializeList<string>(message.Tags);
        messageRow.MetadataJson = StorageSerializer.Serialize(message.Metadata);
        // Also capture any extra data on the message
        messageRow.ExtraJson = (message is IMessageEx messageEx) ?
                               messageEx.SerializeExtraDataToJson() :
                               null;
        return messageRow;
    }

    TMessage FromMessageRow(MessageRow messageRow)
    {
        TMessage message = new TMessage();

        message.TextChunks = StorageSerializer.DeserializeList<string>(messageRow.ChunksJson);
        message.Tags = StorageSerializer.DeserializeList<string>(messageRow.TagsJson);
        message.Timestamp = messageRow.StartTimestamp;
        message.Metadata = StorageSerializer.Deserialize<TMeta>(messageRow.MetadataJson);

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

        int iRow = 0;
        row.ChunksJson = reader.GetStringOrNull(iRow++);
        row.ChunkUri = reader.GetStringOrNull(iRow++);
        row.StartTimestamp = reader.GetStringOrNull(iRow++);
        row.TagsJson = reader.GetStringOrNull(iRow++);
        row.MetadataJson = reader.GetStringOrNull(iRow++);
        row.ExtraJson = reader.GetStringOrNull(iRow);

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
