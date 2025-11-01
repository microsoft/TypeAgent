// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class Resource
{
    // Resource name is: <FullNamespace>.<filename>
    public static string LoadResourceText(Assembly assembly, string resourceName)
    {
        ArgumentVerify.ThrowIfNull(assembly, nameof(assembly));

        using var stream = Load(assembly, resourceName);
        using var reader = new StreamReader(stream);
        string schemaText = reader.ReadToEnd();

        return schemaText;
    }

    // Resource name is: <FullNamespace>.<filename>
    public static List<string> LoadResourceLines(Assembly assembly, string resourceName)
    {
        ArgumentVerify.ThrowIfNull(assembly, nameof(assembly));

        using var stream = Load(assembly, resourceName);
        using var reader = new StreamReader(stream);

        List<string> lines = [];
        string line;
        while ((line = reader.ReadLine()) is not null)
        {
            lines.Add(line);
        }

        return lines;
    }

    private static Stream Load(Assembly assembly, string resourceName)
    {
        return assembly.GetManifestResourceStream(resourceName)
            ?? throw new FileNotFoundException($"Resource not found: {resourceName}");
    }
}
