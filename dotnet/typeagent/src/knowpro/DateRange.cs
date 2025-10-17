// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct DateRange
{
    public DateRange()
    {
    }

    public DateRange(TimestampRange tr)
    {
        Start = DateTimeOffset.Parse(tr.StartTimestamp);
        if (!string.IsNullOrEmpty(tr.EndTimestamp))
        {
            End = DateTimeOffset.Parse(tr.EndTimestamp);
        }
    }

    /// <summary>
    /// The start date of the range (inclusive).
    /// </summary>
    public DateTimeOffset Start { get; set; }
    /// <summary>
    /// The (optional) end date of the range (inclusive).
    /// </summary>
    public DateTimeOffset? End { get; set; }

    [JsonIgnore]
    public readonly bool HasEnd => End is not null;

}

