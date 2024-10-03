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
}
