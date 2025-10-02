// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public struct ScoredItem<T> : IComparable<ScoredItem<T>>
{
    public ScoredItem(T item, double score)
    {
        this.Item = item;
        this.Score = score;
    }

    public T Item { get; set; }
    public double Score { get; set; }

    public readonly int CompareTo(ScoredItem<T> other)
    {
        return this.Score.CompareTo(other.Score);
    }

    public override readonly string ToString() => $"{this.Score}, {this.Item}";

    public static implicit operator double(ScoredItem<T> src)
    {
        return src.Score;
    }

    public static implicit operator T(ScoredItem<T> src)
    {
        return src.Item;
    }

    public static implicit operator ScoredItem<T>(KeyValuePair<T, double> src)
    {
        return new ScoredItem<T>(src.Key, src.Value);
    }
}
