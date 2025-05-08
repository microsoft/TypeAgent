// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Core;

public static class StringEx
{
    public static StringBuilder AppendHeader(this StringBuilder sb, string name, string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            sb.Append(name);
            sb.Append(": ");
            sb.AppendLine(value);
        }
        return sb;
    }

    public static string[] ParseCommandLine(this string cmdLine)
    {
        var regex = new Regex("\"[^\"]+\"|[^\"\\s]+");
        var matches = regex.Matches(cmdLine);
        var args = new List<string>();
        foreach (Match match in matches)
        {
            // Remove the enclosing quotes from the matched strings  
            args.Add(match.Value.Trim('"'));
        }

        return args.ToArray();
    }

    public static string GetArg(this string[] args, int index)
    {
        if (index >= args.Length)
        {
            throw new ArgumentException($"Missing argument at position {index}");
        }
        return args[index];
    }

    public static MemoryStream ToMemoryStream(this string text)
    {
        return new MemoryStream(System.Text.Encoding.UTF8.GetBytes(text));
    }

    public static IEnumerable<string> FilterEmpty(this IEnumerable<string> strings)
    {
        return from str in strings
               where !string.IsNullOrEmpty(str)
               select str;

    }

    public static int IndexOfMin(this string value, IEnumerable<string> delimiters, int startAt = 0)
    {
        int minIndex = -1;
        foreach (var delimiter in delimiters)
        {
            int index = value.IndexOf(delimiter, startAt);
            if (index >= 0 && (minIndex == -1 || index < minIndex))
            {
                minIndex = index;
            }
        }

        return minIndex;
    }
}
