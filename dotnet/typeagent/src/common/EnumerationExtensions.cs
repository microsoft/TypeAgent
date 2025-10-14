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
}
