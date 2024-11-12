// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent;

public static class MailtemEx
{
    public static string BodyLatest(this MailItem item)
    {
        return BodyParser.Default.GetLatest(item.Body);
    }

    public static bool IsForward(this MailItem item)
    {
        var subject = item.Subject.TrimStart();
        return subject.StartsWith("FW", StringComparison.OrdinalIgnoreCase);
    }
}
