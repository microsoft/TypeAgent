// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class HashSetExtensions
{
    public static void AddRange<T>(this HashSet<T> set, IEnumerable<T> items)
    {
        foreach(var item in items)
        {
            set.Add(item);
        }
    }
}
