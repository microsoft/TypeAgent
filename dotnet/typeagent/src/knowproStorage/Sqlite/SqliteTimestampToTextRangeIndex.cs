// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteTimestampToTextRangeIndex : ITimestampToTextRangeIndex
{
    private readonly SqliteDatabase _db;

    public SqliteTimestampToTextRangeIndex(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        _db = db;
    }

    public int GetCount()
    {
        return _db.GetCount(SqliteStorageProviderSchema.MessagesTable);
    }

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
        => ValueTask.FromResult(GetCount());

    public void AddTimestamp(int messageOrdinal, string timestamp)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(timestamp, nameof(timestamp));
        using var cmd = _db.CreateCommand(@"
UPDATE Messages
SET start_timestamp = @timestamp
WHERE msg_id = @msgId
");
        cmd.AddParameter("@timestamp", timestamp);
        cmd.AddParameter("@msgId", messageOrdinal);
        cmd.ExecuteNonQuery();
    }

    public ValueTask AddTimestampAsync(int messageOrdinal, string timestamp)
    {
        AddTimestamp(messageOrdinal, timestamp);
        return ValueTask.CompletedTask;
    }

    public IList<TimestampedTextRange> LookupRange(DateRange dateRange)
    {
        string sql = dateRange.HasEnd
            ? @"
SELECT msg_id, start_timestamp
FROM Messages
WHERE start_timestamp >= @start AND start_timestamp <= @end
ORDER BY start_timestamp
"
            : @"
SELECT msg_id, start_timestamp
FROM Messages
WHERE start_timestamp >= @start
ORDER BY start_timestamp
";

        using var cmd = _db.CreateCommand(sql);
        cmd.AddParameter("@start", dateRange.Start.ToISOString());
        if (dateRange.End.HasValue)
        {
            cmd.AddParameter("@end", dateRange.End.Value.ToISOString());
        }

        using var reader = cmd.ExecuteReader();
        return reader.GetList(ReadTimestampedRange);
    }

    public ValueTask<IList<TimestampedTextRange>> LookupRangeAsync(DateRange dateRange)
        => ValueTask.FromResult(LookupRange(dateRange));

    private TimestampedTextRange ReadTimestampedRange(SqliteDataReader reader)
    {
        int iCol = 0;
        int msgId = reader.GetInt32(iCol++);
        string ts = reader.GetString(iCol);
        return new()
        {
            Timestamp = ts,
            Range = new TextRange(msgId)
        };
    }
}
