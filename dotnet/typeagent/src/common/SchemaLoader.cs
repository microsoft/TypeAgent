// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class SchemaLoader
{
    // Resource name is: <FullNamespace>.<filename>
    public static string LoadResource(Assembly assembly, string resourceName)
    {
        ArgumentVerify.ThrowIfNull(assembly, nameof(assembly));

        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new FileNotFoundException($"Resource not found: {resourceName}");
        using var reader = new StreamReader(stream);
        string schemaText = reader.ReadToEnd();
        RemoveCopyright(schemaText);
        return schemaText;
    }

    public static string RemoveCopyright(string text)
    {
        text = text.Replace("// Copyright (c) Microsoft Corporation.", "");
        text = text.Replace("// Licensed under the MIT License.", "");
        return text;
    }
}
