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

    public static IEnumerable<IList<T>> Batch<T>(this IEnumerable<T> items, int batchSize, IList<T>? buffer = null)
    {
        bool userBuffer = buffer is not null;
        using var enumerator = items.GetEnumerator();

        IList<T> batch = userBuffer ? buffer : new List<T>(batchSize);
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
}
