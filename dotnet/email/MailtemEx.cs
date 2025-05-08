// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;

namespace TypeAgent;

public static class MailtemEx
{
    public static bool HasBody(this MailItem item)
    {
        return !string.IsNullOrEmpty(item.Body);
    }

    public static string BodyLatest(this MailItem item)
    {
        return BodyParser.Default.GetLatest(item.Body);
    }

    public static bool IsForward(this MailItem item)
    {
        var subject = item.Subject.TrimStart();
        return subject.StartsWith("FW", StringComparison.OrdinalIgnoreCase);
    }

    public static void SaveAsText(this MailItem item, string savePath)
    {
        item.SaveAs(savePath, OlSaveAsType.olTXT);
    }

    public static string ToText(this MailItem item)
    {
        string textFilePath = Path.GetTempFileName();
        try
        {
            item.SaveAsText(textFilePath);
            string mailText = File.ReadAllText(textFilePath);
            return mailText;
        }
        finally
        {
            FileEx.SafeDelete(textFilePath);
        }
    }
}
