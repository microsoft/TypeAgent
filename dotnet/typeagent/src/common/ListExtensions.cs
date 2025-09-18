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

    public static IList<TResult> Map<T, TResult>(this IList<T> list, Func<T, TResult> mapFn)
    {
        ArgumentVerify.ThrowIfNull(mapFn, nameof(mapFn));

        List<TResult> results = [];
        int count = list.Count;
        for (int i = 0; i <count; ++i)
        {
            results.Add(mapFn(list[i]));
        }
        return results;
    }
}
