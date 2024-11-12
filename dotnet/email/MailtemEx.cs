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
        return item.Subject.StartsWith("FW:", StringComparison.OrdinalIgnoreCase);
    }
}
