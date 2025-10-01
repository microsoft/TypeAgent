// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class FileExtensions
{
    public static void RemoveFiles(params string[] filePaths)
    {
        foreach(string filePath in filePaths)
        {
            File.Delete(filePath);
        }
    }

    public static void VerifyExists(string path)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(path);
        }
    }
}
