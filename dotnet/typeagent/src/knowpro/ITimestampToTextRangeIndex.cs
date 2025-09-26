// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITimestampToTextRangeIndex
{
    Task<int> GetCountAsync(CancellationToken cancellationToken = default);

    Task AddTimestampAsync(int messageOrdinal, string timestamp);

    // TODO: Bulk operations

    Task<IList<TimestampedTextRange>> LookupRangeAsync(DateRange dateRange);
}

public struct TimestampedTextRange
{
    public string Timestamp { get; set; }

    public TextRange Range { get; set; }
}
