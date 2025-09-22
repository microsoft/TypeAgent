// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


using System.Text.Json.Nodes;

namespace TypeAgent.KnowPro.Storage.Sqlite;

/// <summary>
/// Schema is in SqliteStorageProviderSchema.cs
/// </summary>
/// <typeparam name="TMessage"></typeparam>
public class SqliteMessageCollection<TMessage> : IMessageCollection<TMessage>
    where TMessage : IMessage, new()
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
            @"INSERT INTO Messages (chunks, chunk_uri, start_timestamp, tags, metadata, extra)
          VALUES (@chunks, @chunk_uri, @start_timestamp, @tags, @metadata, @extra);"
        );
        cmd.Parameters.AddWithValue("@chunks", messageRow.TextChunks);
        cmd.Parameters.AddWithValue("@tags", messageRow.Tags);
        cmd.Parameters.AddWithValue(
            "@start_timestamp",
            messageRow.StartTimestamp is not null ? messageRow.StartTimestamp : DBNull.Value
        );
        cmd.Parameters.AddWithValue(
            "@metadata",
            messageRow.Metadata is not null ? messageRow.Metadata : DBNull.Value
        );
        cmd.Parameters.AddWithValue(
            "@extra",
            messageRow.Extra is not null ? messageRow.Extra : DBNull.Value
        );
        return Task.FromResult(cmd.ExecuteNonQuery());
    }

    public Task AppendAsync(IEnumerable<TMessage> items)
    {
        throw new NotImplementedException();
    }

    public Task<TMessage> GetAsync(int ordinal)
    {
        throw new NotImplementedException();
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

        messageRow.TextChunks = JsonSerializer.Serialize(message.TextChunks);
        messageRow.Tags = !message.Tags.IsNullOrEmpty() ? JsonSerializer.Serialize(message.Tags) : Json.EmptyArray;
        if (!string.IsNullOrEmpty(message.Timestamp))
        {
            messageRow.StartTimestamp = message.Timestamp;
        }
        if (message.Metadata is not null)
        {
            messageRow.Metadata = JsonSerializer.Serialize(message.Metadata);
        }
        // Also capture any extra data on the message
        if (message is IMessageEx messageEx)
        {
            messageRow.Extra = messageEx.SerializeExtraDataToJson();
        }
        return messageRow;
    }
}

internal class MessageRow
{
    public string TextChunks { get; set; }
    public string Tags { get; set; }
    public string? StartTimestamp { get; set; }
    public string? Metadata { get; set; }
    public string Extra { get; set; }
}
