// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class ListExtensions
{
    /// <summary>
    /// Returns true if the list is null or Count == 0
    /// </summary>
    /// <typeparam name="T"></typeparam>
    /// <param name="list"></param>
    /// <returns></returns>
    public static bool IsNullOrEmpty<T>(this IList<T>? list)
    {
        return list is null || list.Count == 0;
    }

    public static int GetCount<T>(this IList<T>? list)
    {
        return list is not null ? list.Count : 0;
    }

    public static void Shift<T>(this IList<T> list)
    {
        if (list.Count > 0)
        {
            list.RemoveAt(0);
        }
    }

    public static List<TResult> Map<T, TResult>(this IList<T> list, Func<T, TResult> mapFn)
    {
        ArgumentVerify.ThrowIfNull(mapFn, nameof(mapFn));

        List<TResult> results = new List<TResult>(list.Count);
        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            results.Add(mapFn(list[i]));
        }
        return results;
    }

    public static List<T> Filter<T>(this IList<T> list, Func<T, bool> filter)
    {
        List<T> filtered = [];
        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            var item = list[i];
            if (filter(item))
            {
                filtered.Add(item);
            }
        }
        return filtered;
    }

    public static string Join<T>(this IList<T> list, string sep = ", ")
    {
        return string.Join(sep, list.Select((t) => t.ToString()));
    }

    public static IEnumerable<IList<T>> Batch<T>(this IList<T> items, int batchSize, IList<T>? buffer = null)
    {
        if (items.Count <= batchSize)
        {
            yield return items;
        }
        else
        {
            foreach (var batch in EnumerationExtensions.Batch(items, batchSize, buffer))
            {
                yield return batch;
            }
        }
    }
}
