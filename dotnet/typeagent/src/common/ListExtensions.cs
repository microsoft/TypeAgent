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
    public static bool IsNullOrEmpty<T>(this IList<T> list)
    {
        return list is null || list.Count == 0;
    }

    public static int GetCount<T>(this IList<T> list)
    {
        return list is not null ? list.Count : 0;
    }

    public static IEnumerable<T> Slice<T>(this IList<T> list, int startAt, int count, int stride = 1)
    {
        if (stride < 0)
        {
            for (int i = Math.Min(startAt + count, list.Count) - 1; i >= startAt; i -= stride)
            {
                yield return list[i];
            }
        }
        else if (stride > 0)
        {
            for (int i = startAt, max = Math.Min(startAt + count, list.Count); i < max; i += stride)
            {
                yield return list[i];
            }
        }
    }

    public static IEnumerable<T> Slice<T>(this IList<T> list, int startAt)
    {
        return list.Slice(startAt, list.Count - startAt);
    }

    public static void Shift<T>(this IList<T> list)
    {
        if (list.Count > 0)
        {
            list.RemoveAt(0);
        }
    }

    public static IList<TResult> Map<T, TResult>(this IList<T> list, Func<T, TResult> mapFn)
    {
        ArgumentVerify.ThrowIfNull(mapFn, nameof(mapFn));

        List<TResult> results = new List<TResult>(list.Count);
        foreach (var item in list)
        {
            results.Add(mapFn(item));
        }
        return results;
    }

    public static IList<T> Filter<T>(this IList<T> list, Func<T, bool> filter)
    {
        IList<T> filtered = [];
        foreach (T item in list)
        {
            if (filter(item))
            {
                filtered.Add(item);
            }
        }
        return filtered;
    }
}
