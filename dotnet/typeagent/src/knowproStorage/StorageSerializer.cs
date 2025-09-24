// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage;

internal class StorageSerializer : Serializer
{
    internal static string? ToJson<T>(IList<T>? list)
    {
        return !list.IsNullOrEmpty() ? JsonSerializer.Serialize(list, Options) : null;
    }

    internal static List<T> FromJsonArray<T>(string? json)
    {
        List<T>? list = null;
        if (!string.IsNullOrEmpty(json))
        {
            list = JsonSerializer.Deserialize<List<T>>(json, Options);
        }
        return list ?? [];
    }
}
