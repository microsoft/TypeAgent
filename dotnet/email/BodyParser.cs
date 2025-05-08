// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;

namespace TypeAgent;

public class BodyParser
{
    public static readonly BodyParser Default = new BodyParser();

    List<string> _delimiters;
    Regex _splitBody;

    public BodyParser()
    {
        _delimiters = new List<string>
        {
            "From:",
            "Sent:",
            "To:",
            "Subject:",
            "-----Original Message-----",
            "----- Forwarded by",
            "________________________________________"
        };
        _splitBody = new Regex("(?=From:)", RegexOptions.IgnoreCase);

    }

    public List<string> Delimiters => _delimiters;

    public string GetLatest(string body)
    {
        if (string.IsNullOrEmpty(body))
        {
            return string.Empty;
        }
        int firstDelimiterAt = -1;
        foreach (var delimiter in _delimiters)
        {
            int index = body.IndexOf(delimiter);
            if (index >= 0 && (firstDelimiterAt == -1 || index < firstDelimiterAt))
            {
                firstDelimiterAt = index;
            }
        }

        if (firstDelimiterAt >= 0)
        {
            return body[..firstDelimiterAt].Trim();
        }

        return body;
    }

    public string[] SplitForwardedEmail(string email)
    {
        string[] parts = _splitBody.Split(email);
        return parts.FilterEmpty().ToArray();
    }

}
