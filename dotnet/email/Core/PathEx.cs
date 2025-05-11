// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Core;

public static class PathEx
{
    public static bool IsDirectory(string filePath)
    {
        try
        {
            return File.GetAttributes(filePath).HasFlag(FileAttributes.Directory);
        }
        catch (FileNotFoundException)
        {
        }
        catch (DirectoryNotFoundException)
        {
        }

        return false;
    }

    public static string ReplaceFileNameExtension(string fileName, string newExt)
    {
        if (string.IsNullOrEmpty(newExt))
        {
            return fileName;
        }

        return Path.GetFileNameWithoutExtension(fileName) + newExt;
    }

    public static string AppendNumber(string filePath, int number)
    {
        string newName = $"{Path.GetFileNameWithoutExtension(filePath)}_{number}{Path.GetExtension(filePath)}";
        return Path.Join(Path.GetDirectoryName(filePath), newName);
    }
}
