// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct DateRange
{
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

