// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class DictionaryExtensions
{
    public static TValue? Get<TKey, TValue>(this IDictionary<TKey, TValue> dict, TKey key)
        where TValue : class
    {
        return dict.TryGetValue(key, out var value) ? value : null;
    }
}
