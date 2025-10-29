// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public readonly struct BatchProgress
{
    public BatchProgress(int countCompleted, int count)
    {
        CountCompleted = countCompleted;
        Count = count;
    }

    /// <summary>
    /// Size of the batch
    /// </summary>
    public int Count { get; }
    /// <summary>
    /// Total completed
    /// </summary>
    public int CountCompleted { get; }
}

public readonly struct Batch<T>
{
    public Batch(IList<T> items, int startAt, int total)
    {
        Items = items;
        BatchStartAt = startAt;
        TotalCount = total;
    }

    public IList<T> Items { get; }
    public int BatchStartAt { get; }
    public int TotalCount { get; }
}
