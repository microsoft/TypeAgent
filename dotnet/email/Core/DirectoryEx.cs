// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Core;

public static class DirectoryEx
{
    public static void Ensure(string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(path, nameof(path));

        if (!Directory.Exists(path))
        {
            DirectoryInfo info = Directory.CreateDirectory(path);
            if (!info.Exists)
            {
                throw new DirectoryNotFoundException(path);
            }
        }
    }
}
