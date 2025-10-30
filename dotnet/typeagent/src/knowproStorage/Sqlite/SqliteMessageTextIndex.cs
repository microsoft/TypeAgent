// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteMessageTextIndex : IMessageTextIndex
{
    private SqliteDatabase _db;

    public SqliteMessageTextIndex(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        _db = db;
    }

    public ValueTask AddMessagesAsync(IList<IMessage> messages, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesAsync(string messageText, int? maxMatches = null, double? thresholdScore = null, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesInSubsetAsync(string messageText, IEnumerable<int> ordinalsToSearch, int? maxMatches = null, double? thresholdScore = null, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
