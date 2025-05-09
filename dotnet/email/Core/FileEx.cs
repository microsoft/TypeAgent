// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Core;

public static class FileEx
{
    public static string MakeUnique(string rootPath, string fileName, string ext)
    {
        string filePath = Path.Join(rootPath, fileName + ext);
        int count = 0;
        while (File.Exists(filePath))
        {
            ++count;
            string uniqueName = $"{fileName} ({count}){ext}";
            filePath = Path.Join(rootPath, uniqueName);
        }
        return filePath;
    }

    public static string SanitizeFileName(string fileName, int maxLength = -1)
    {
        if (maxLength > 0 && fileName.Length > maxLength)
        {
            fileName = fileName[..maxLength];
        }

        char[] invalidChars = Path.GetInvalidFileNameChars();
        StringBuilder sanitizedFileName = new StringBuilder();
        foreach (char ch in fileName)
        {
            if (Array.IndexOf(invalidChars, ch) == -1)
            {
                sanitizedFileName.Append(ch);
            }
        }

        return sanitizedFileName.ToString();
    }

    public static bool SafeDelete(string filePath)
    {
        try
        {
            File.Delete(filePath);
            return true;
        }
        catch
        {
        }
        return false;
    }
}
