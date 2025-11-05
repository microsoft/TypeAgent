// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace TypeAgent.Common;

public static partial class StringExtensions 
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

    [GeneratedRegex(@"\r?\n", RegexOptions.Compiled)]
    private static partial Regex s_lineSplitRegex(); // This is now valid in a partial class

    private static readonly Regex s_lineSplitter = s_lineSplitRegex();

    public static IList<string> SplitLines(this string text, StringSplitOptions options = default)
        => text.Split(s_lineSplitter, options);

    public static IList<string> Split(this string text, Regex regex, StringSplitOptions options = default)
    {
        ArgumentVerify.ThrowIfNull(regex, nameof(regex));

        string[] parts = regex.Split(text);
        if (options == StringSplitOptions.None)
        {
            return parts;
        }
        if ((options & StringSplitOptions.TrimEntries) != 0)
        {
            for (int i = 0; i < parts.Length; ++i)
            {
                parts[i] = parts[i].Trim();
            }
        }
        if ((options & StringSplitOptions.RemoveEmptyEntries) != 0)
        {
            List<string> filteredParts = new List<string>(parts.Length);
            for (int i = 0; i < parts.Length; ++i)
            {
                if (!string.IsNullOrEmpty(parts[i]))
                {
                    filteredParts.Add(parts[i]);
                }
            }
            return filteredParts;
        }
        else
        {
            return parts;
        }
    }
}
