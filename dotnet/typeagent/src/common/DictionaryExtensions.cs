// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class DictionaryExtensions
{
    public static bool IsNullOrEmpty<TKey, TValue>(this IDictionary<TKey, TValue>? dictionary)
    {
        return dictionary is null || dictionary.Count == 0;
    }

    public static TValue GetValueOrDefault<TKey, TValue>(this IDictionary<TKey, TValue> dictionary, TKey key, TValue defaultValue = default)
    {
        return dictionary.TryGetValue(key, out TValue? value) ? value : defaultValue;
    }
}
