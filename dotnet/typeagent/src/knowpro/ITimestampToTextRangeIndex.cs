// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITimestampToTextRangeIndex
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask AddTimestampAsync(int messageOrdinal, string timestamp);

    // TODO: Bulk operations

    ValueTask<IList<TimestampedTextRange>> LookupRangeAsync(DateRange dateRange);
}

public struct TimestampedTextRange
{
    public string Timestamp { get; set; }

    public TextRange Range { get; set; }
}
