// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public struct Scored<T> : IComparable<Scored<T>>
{
    public Scored(T item, double score)
    {
        this.Item = item;
        this.Score = score;
    }

    public T Item { get; set; }
    public double Score { get; set; }

    public readonly int CompareTo(Scored<T> other)
    {
        return this.Score.CompareTo(other.Score);
    }

    public override readonly string ToString() => $"{this.Score}, {this.Item}";

    public static implicit operator double(Scored<T> src)
    {
        return src.Score;
    }

    public static implicit operator T(Scored<T> src)
    {
        return src.Item;
    }

    public static implicit operator Scored<T>(KeyValuePair<T, double> src)
    {
        return new Scored<T>(src.Key, src.Value);
    }
}
