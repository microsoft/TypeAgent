// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent;

public static class MailtemEx
{
    public static string BodyLatest(this MailItem item)
    {
        return BodyParser.Default.GetLatest(item.Body);
    }
}
