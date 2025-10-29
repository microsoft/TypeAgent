// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public readonly struct BatchItem<T>
{
    public BatchItem(T item, int pos, int count)
    {
        Item = item;
        Pos = pos;
        Count = count;
    }

    public T Item { get; }
    public int Pos { get; }
    public int Count { get; }

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
