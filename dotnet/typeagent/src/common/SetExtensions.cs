// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class SetExtensions
{
    public static void LoadFromFile(this HashSet<string> set, string filePath)
    {
        foreach(var line in File.ReadLines(filePath))
        {
            var entry = line.Trim();
            if (!string.IsNullOrEmpty(entry))
            {
                set.Add(entry);
            }
        }
    }

    public static void LoadFromResource(this HashSet<string> set, Assembly assembly, string resourceName)
    {
        foreach (var line in Resource.LoadResourceLines(assembly, resourceName))
        {
            var entry = line.Trim();
            if (!string.IsNullOrEmpty(entry))
            {
                set.Add(entry);
            }
        }
    }
}
