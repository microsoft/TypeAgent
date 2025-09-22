// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TypeAgent.KnowPro.Storage;

internal static class StorageSerializer
{
    internal static string? Serialize<T>(T? value)
    {
        return value is not null ? JsonSerializer.Serialize(value) : null;
    }

    internal static string? SerializeList<T>(IList<T>? list)
    {
        return !list.IsNullOrEmpty() ? JsonSerializer.Serialize(list) : null;
    }

    internal static T? Deserialize<T>(string? json)
    {
        return !string.IsNullOrEmpty(json) ? JsonSerializer.Deserialize<T>(json) : default;
    }

    internal static List<T> DeserializeList<T>(string? json)
    {
        List<T>? list = null;
        if (!string.IsNullOrEmpty(json))
        {
            list = JsonSerializer.Deserialize<List<T>>(json);
        }
        return list ?? [];
    }
}
