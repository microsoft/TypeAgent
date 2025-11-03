// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace TypeAgent.Common;

public static class StringExtensions
{
    /// <summary>
    /// Splits an enumerable of strings into chunks, each chunk containing up to maxChunkLength strings and
    /// no more than maxCharsPerChunk total characters. Strings longer than maxCharsPerChunk are truncated.
    /// </summary>
    public static IEnumerable<List<string>> GetStringChunks(
        this IEnumerable<string> values,
        int maxChunkLength,
        int maxCharsPerChunk
    )
    {
        var chunk = new List<string>(maxChunkLength);
        int totalCharsInChunk = 0;

        foreach (var valueRaw in values)
        {
            var value = valueRaw.Length > maxCharsPerChunk
                ? valueRaw[..maxCharsPerChunk] // Range operator for truncation
                : valueRaw;

            if (chunk.Count == maxChunkLength || value.Length + totalCharsInChunk > maxCharsPerChunk)
            {
                if (totalCharsInChunk > 0)
                {
                    yield return chunk;
                }

                chunk = new List<string>(maxChunkLength);
                totalCharsInChunk = 0;
            }

            chunk.Add(value);
            totalCharsInChunk += value.Length;
        }

        if (totalCharsInChunk > 0)
        {
            yield return chunk;
        }
    }

    public static List<string> LowerAndSort(this List<string> list)
    {
        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            list[i] = list[i].ToLower();
        }
        list.Sort();
        return list;
    }

}
