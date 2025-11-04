// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class EnumerationExtensions
{
    public static IEnumerable<(int, T)> Enumerate<T>(this IEnumerable<T> list)
    {
        int i = 0;
        foreach (var item in list)
        {
            yield return (i, item);
            ++i;
        }
    }

    public static void ForEach<T>(this IEnumerable<T> list, Action<T> fn)
    {
        ArgumentVerify.ThrowIfNull(fn, nameof(fn));

        foreach (var item in list)
        {
            fn(item);
        }
    }

    public static List<TResult> Map<T, TResult>(this IEnumerable<T> list, Func<T, TResult> mapFn)
    {
        ArgumentVerify.ThrowIfNull(mapFn, nameof(mapFn));

        List<TResult> results = [];
        foreach (var item in list)
        {
            results.Add(mapFn(item));
        }
        return results;
    }

    public static List<T> Flat<T>(this IEnumerable<IEnumerable<T>> list)
    {
        var result = new List<T>();
        foreach (var inner in list)
        {
            if (inner is not null)
            {
                result.AddRange(inner);
            }
        }
        return result;
    }

    public static IEnumerable<List<T>> Batch<T>(this IEnumerable<T> items, int batchSize, List<T>? buffer = null)
    {
        bool userBuffer = buffer is not null;
        using var enumerator = items.GetEnumerator();

        List<T> batch = userBuffer ? buffer : new List<T>(batchSize);
        while (enumerator.MoveNext())
        {
            batch.Add(enumerator.Current);
            if (batch.Count == batchSize)
            {
                yield return batch;
                if (userBuffer)
                {
                    batch.Clear();
                }
                else
                {
                    batch = new List<T>(batchSize);
                }
            }
        }

        if (!batch.IsNullOrEmpty())
        {
            yield return batch;
        }
    }

    public static List<Scored<T>> GetTopK<T>(this IEnumerable<Scored<T>> items, int topk)
    {
        ArgumentVerify.ThrowIfNull(items, nameof(items));

        var topNList = new TopNCollection<T>(topk);
        topNList.Add(items);
        return topNList.ByRankAndClear();
    }
}
