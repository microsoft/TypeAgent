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
}
