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

        List<TResult> results = [];
        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            results.Add(mapFn(list[i]));
        }
        return results;
    }

}
