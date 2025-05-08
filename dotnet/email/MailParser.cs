// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;

namespace TypeAgent;

public class MailParser
{
    public static readonly MailParser Default = new MailParser();

    MailParser() { }

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
            var bodyStart = line.Trim();
            if (string.IsNullOrEmpty(bodyStart))
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
                curFieldVal = !string.IsNullOrEmpty(fieldVal) ? fieldVal.TrimStart() : fieldVal;
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
        for (; i < lines.Length; ++i)
        {
            if (!string.IsNullOrEmpty(lines[i]))
            {
                break;
            }
        }
        if (i < lines.Length)
        {
            string body = string.Join("\r\n", lines, i, lines.Length - i);
            yield return new KeyValuePair<string, string>("Body", body);
        }
    }

}
