// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

internal static class StringEx
{
    internal static void ExtractLine(this string text, long lineNumber, StringBuilder sb)
    {
        string line;
        long i = 0;
        long iPrev = lineNumber - 1;
        long iNext = lineNumber + 1;
        using StringReader reader = new StringReader(text);
        while ((line = reader.ReadLine()) is not null)
        {
            if (i == iPrev ||
                i == lineNumber ||
                i == iNext)
            {
                sb.TrimAndAppendLine(line);
                if (i == iNext)
                {
                    break;
                }
            }
            ++i;
        }
    }

    internal static StringBuilder AppendLineNotEmpty(this StringBuilder sb, string line)
    {
        if (!string.IsNullOrEmpty(line))
        {
            sb.AppendLine(line);
        }
        return sb;
    }

    internal static StringBuilder TrimAndAppendLine(this StringBuilder sb, string line)
    {
        sb.AppendLineNotEmpty(line.Trim());
        return sb;
    }

    internal static StringBuilder AppendMultiple(this StringBuilder sb, string sep, IEnumerable<string> substrings)
    {
        int i = 0;
        foreach (var substring in substrings)
        {
            if (i > 0) { sb.Append(sep); }
            sb.Append(substring);
            ++i;
        }
        return sb;
    }
}
