// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class SchemaLoader
{
    // Super basic right now. 
    public static string Load(string filePath)
    {
        // Delegate parameter checking
        string text = File.ReadAllText(filePath);
        text = RemoveCopyright(text);
        return text;
    }

    public static string RemoveCopyright(string text)
    {
        text = text.Replace("// Copyright (c) Microsoft Corporation.", "");
        text = text.Replace("// Licensed under the MIT License.", "");
        return text;
    }
}
