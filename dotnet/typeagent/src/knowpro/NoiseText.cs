// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Reflection;

namespace TypeAgent.KnowPro;

public class NoiseText : HashSet<string>
{
    public NoiseText()
        : base(StringComparer.OrdinalIgnoreCase)
    {
    }

    public NoiseText(string srcFilePath)
        : this()
    {
        this.LoadFromFile(srcFilePath);
    }

    public NoiseText(Assembly assembly, string resourcePath)
        : this()
    {
        this.LoadFromResource(assembly, resourcePath);
    }

    public bool IsNoise(string value) => Contains(value);
}
