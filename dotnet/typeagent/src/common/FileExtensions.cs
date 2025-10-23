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

    public static IEnumerable<string> ReadBatchLines(string filePath, char commentChar)
    {
        // Delete param checking
        foreach (var line in File.ReadLines(filePath))
        {
            var trimmedLine = line.Trim();

            // Skip empty lines and comments
            if (!string.IsNullOrWhiteSpace(trimmedLine) && !trimmedLine.StartsWith(commentChar))
            {
                yield return trimmedLine;
            }

        }
    }
}
