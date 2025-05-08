// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;

namespace TypeAgent;

public class MailParser
{
    public static readonly MailParser Default = new MailParser();

    Regex _splitBody;
    Regex _fieldRegex;

    MailParser()
    {
        _splitBody = new Regex("(?=From:)", RegexOptions.IgnoreCase);
        _fieldRegex = new Regex(@"^(?<headerName>[^:]+):(?<headerValue>[^\r\n]+)", RegexOptions.IgnoreCase | RegexOptions.Multiline);
    }

    public string[] SplitForwardedEmail(string email)
    {
        string[] parts = _splitBody.Split(email);
        return parts.FilterEmpty().ToArray();
    }

    /*
    public IEnumerable<KeyValuePair<string, string>> ParseParts(string message)
    {
        var matches = _fieldRegex.Matches(message);
        string curHeader = string.Empty;
        string curValue = string.Empty;
        int bodyStartAt = 0;
        foreach(Match match in matches)
        {
            string headerName = match.Groups["headerName"].Value;
            string headerValue = match.Groups["headerValue"].Value;
            if (!string.IsNullOrEmpty(headerName))
            {
                if (!string.IsNullOrEmpty(curHeader))
                {
                    yield return new KeyValuePair<string, string>(curHeader, curValue);
                }
                curHeader = headerName;
                curValue = headerValue;
            }
            else
            {
                curValue += " " + headerValue.Trim();
            }
            bodyStartAt = match.Index + match.Length;
        }
        if (!string.IsNullOrEmpty(curHeader))
        {
            yield return new KeyValuePair<string, string>(curHeader, curValue);
        }
        if (bodyStartAt < message.Length)
        {
            bodyStartAt += "\r\n".Length;
            yield return new KeyValuePair<string, string>("Body", message[bodyStartAt..]);
        }
    }
    */

    public IEnumerable<KeyValuePair<string, string>> ParseParts(string message)
    {
        var lines = message.Split("\r\n");
        string fieldName = null;
        string fieldVal = null;
        string curFieldName = null;
        string curFieldVal = string.Empty;
        int i = 0;
        for (; i < lines.Length; ++i)
        {
            var line = lines[i];
            if (string.IsNullOrEmpty(line))
            {
                ++i;
                break;
            }
            fieldName = null;
            fieldVal = null;
            int nameEndPos = line.IndexOf(':');
            int valueStartPos = 0;
            if (nameEndPos >= 0)
            {
                fieldName = line[..nameEndPos];
                valueStartPos = nameEndPos + 1;
            }
            if (valueStartPos < line.Length)
            {
                fieldVal = line[(nameEndPos + 1)..];
            }
            if (!string.IsNullOrEmpty(fieldName))
            {
                if (!string.IsNullOrEmpty(curFieldName))
                {
                    yield return new KeyValuePair<string, string>(curFieldName, curFieldVal);
                }
                curFieldName = fieldName;
                curFieldVal = fieldVal.TrimStart();
            }
            else if (!string.IsNullOrEmpty(fieldVal))
            {
                curFieldVal += fieldVal;
            }
        }
        if (!string.IsNullOrEmpty(curFieldName))
        {
            yield return new KeyValuePair<string, string>(curFieldName, curFieldVal);
        }
        if (i < lines.Length)
        {
            yield return new KeyValuePair<string, string>("Body", string.Join("\r\n", lines, i, lines.Length - i));
        }
    }

}
