// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage;

internal static class StorageSerializer
{
    static JsonSerializerOptions s_options;

    static StorageSerializer()
    {
        s_options = Json.DefaultOptions();
    }

    internal static string? Serialize<T>(T? value)
    {
        return value is not null ? JsonSerializer.Serialize(value, s_options) : null;
    }

    internal static string? SerializeList<T>(IList<T>? list)
    {
        return !list.IsNullOrEmpty() ? JsonSerializer.Serialize(list, s_options) : null;
    }

    internal static T? Deserialize<T>(string? json)
    {
        return !string.IsNullOrEmpty(json) ? JsonSerializer.Deserialize<T>(json, s_options) : default;
    }

    internal static List<T> DeserializeList<T>(string? json)
    {
        List<T>? list = null;
        if (!string.IsNullOrEmpty(json))
        {
            list = JsonSerializer.Deserialize<List<T>>(json, s_options);
        }
        return list ?? [];
    }
}
