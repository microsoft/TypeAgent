// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Uia;

internal static class SelectorParser
{
    public static SelectorPath Parse(string input)
    {
        if (string.IsNullOrEmpty(input))
        {
            throw new FormatException("Selector cannot be empty");
        }
        if (input[0] != '/')
        {
            throw new FormatException("Selector must start with '/'");
        }

        var segments = new List<SelectorSegment>();
        int i = 0;
        while (i < input.Length)
        {
            if (input[i] != '/')
            {
                throw new FormatException($"Expected '/' at position {i}");
            }
            i++;

            int idStart = i;
            if (i >= input.Length || !IsIdentStart(input[i]))
            {
                throw new FormatException($"Expected identifier at position {i}");
            }
            i++;
            while (i < input.Length && IsIdentRest(input[i]))
            {
                i++;
            }
            string controlType = input.Substring(idStart, i - idStart);

            string? name = null, autoId = null, className = null;
            int? index = null;

            while (i < input.Length && input[i] == '[')
            {
                i++;
                if (i < input.Length && char.IsDigit(input[i]))
                {
                    int numStart = i;
                    while (i < input.Length && char.IsDigit(input[i]))
                    {
                        i++;
                    }
                    if (i >= input.Length || input[i] != ']')
                    {
                        throw new FormatException($"Expected ']' after index at position {i}");
                    }
                    index = int.Parse(input.AsSpan(numStart, i - numStart));
                    i++;
                }
                else
                {
                    int keyStart = i;
                    if (i >= input.Length || !IsIdentStart(input[i]))
                    {
                        throw new FormatException($"Expected predicate key at position {i}");
                    }
                    i++;
                    while (i < input.Length && IsIdentRest(input[i]))
                    {
                        i++;
                    }
                    string key = input.Substring(keyStart, i - keyStart);
                    if (i >= input.Length || input[i] != '=')
                    {
                        throw new FormatException($"Expected '=' at position {i}");
                    }
                    i++;
                    if (i >= input.Length || input[i] != '"')
                    {
                        throw new FormatException($"Expected '\"' at position {i}");
                    }
                    i++;

                    var sb = new StringBuilder();
                    while (i < input.Length && input[i] != '"')
                    {
                        if (input[i] == '\\' && i + 1 < input.Length)
                        {
                            sb.Append(input[i + 1]);
                            i += 2;
                        }
                        else
                        {
                            sb.Append(input[i]);
                            i++;
                        }
                    }
                    if (i >= input.Length)
                    {
                        throw new FormatException("Unterminated string value");
                    }
                    i++;
                    if (i >= input.Length || input[i] != ']')
                    {
                        throw new FormatException($"Expected ']' after predicate at position {i}");
                    }
                    i++;

                    string value = sb.ToString();
                    switch (key)
                    {
                        case "Name": name = value; break;
                        case "AutomationId": autoId = value; break;
                        case "ClassName": className = value; break;
                        default:
                            throw new FormatException($"Unknown predicate key: {key}");
                    }
                }
            }

            segments.Add(new SelectorSegment(controlType, name, autoId, className, index));
        }

        if (segments.Count == 0)
        {
            throw new FormatException("Selector must have at least one segment");
        }

        return new SelectorPath(segments);
    }

    public static string Format(SelectorPath path)
    {
        var sb = new StringBuilder();
        foreach (var seg in path.Segments)
        {
            sb.Append('/').Append(seg.ControlType);
            if (seg.AutomationId != null)
            {
                sb.Append("[AutomationId=\"").Append(Escape(seg.AutomationId)).Append("\"]");
            }
            if (seg.Name != null)
            {
                sb.Append("[Name=\"").Append(Escape(seg.Name)).Append("\"]");
            }
            if (seg.ClassName != null)
            {
                sb.Append("[ClassName=\"").Append(Escape(seg.ClassName)).Append("\"]");
            }
            if (seg.Index.HasValue)
            {
                sb.Append('[').Append(seg.Index.Value).Append(']');
            }
        }
        return sb.ToString();
    }

    public static string FormatSegment(SelectorSegment seg) =>
        Format(new SelectorPath(new[] { seg }));

    private static string Escape(string s) =>
        s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private static bool IsIdentStart(char c) => char.IsLetter(c) || c == '_';
    private static bool IsIdentRest(char c) => char.IsLetterOrDigit(c) || c == '_';
}
