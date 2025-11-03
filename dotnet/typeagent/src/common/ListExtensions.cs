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

    public static List<T> Slice<T>(this IList<T> list, int start, int count)
    {
        ArgumentVerify.ThrowIfLessThan(start, 0, nameof(start));
        ArgumentVerify.ThrowIfLessThan(count, 0, nameof(count));
        ArgumentVerify.ThrowIfGreaterThan(start + count, list.Count, nameof(count));

        count = Math.Min(count, list.Count - start);
        var result = new List<T>(count);
        for (int i = 0; i < count; ++i)
        {
            result.Add(list[start + i]);
        }
        return result;
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

    public static List<TResult> FlatMap<T, TResult>(this IEnumerable<T> list, Func<T, IList<TResult>> mapFn)
    {
        ArgumentVerify.ThrowIfNull(mapFn, nameof(mapFn));

        List<TResult> results = [];
        foreach (var item in list)
        {
            results.AddRange(mapFn(item).AsReadOnly());
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

    public static IEnumerable<IList<T>> Batch<T>(this IList<T> list, int batchSize, List<T>? buffer = null)
    {
        if (list.Count <= batchSize)
        {
            yield return list;
        }
        else
        {
            foreach (var batch in EnumerationExtensions.Batch(list, batchSize, buffer))
            {
                yield return batch;
            }
        }
    }

    public static int BinarySearchFirst<T, TSearchValue>(
        this IList<T> list,
        TSearchValue value,
        Func<T, TSearchValue, int> compareFn,
        int startAt = 0
    )
    {
        int lo = startAt;
        int hi = list.Count - 1;
        while (lo <= hi)
        {
            int mid = (lo + hi) >> 1;
            int cmp = compareFn(list[mid], value);
            if (cmp < 0)
            {
                lo = mid + 1;
            }
            else
            {
                hi = mid - 1;
            }
        }

        return lo;
    }

    public static List<Scored<T>> GetTopK<T>(this IEnumerable<Scored<T>> list, int topK)
    {
        var topNList = new TopNCollection<T>(topK);
        topNList.Add(list);
        return topNList.ByRankAndClear();
    }

    public static void Fill<T>(this IList<T> list, T value, int count)
    {
        for (int i = 0; i < count; ++i)
        {
            list.Add(value);
        }
    }

    public static T[] Append<T>(this T[]? list, T value)
    {
        if (list.IsNullOrEmpty())
        {
            return [value];
        }

        T[] copy = new T[list.Length + 1];
        Array.Copy(list, copy, list.Length);
        copy[list.Length] = value;
        return copy;
    }
}
