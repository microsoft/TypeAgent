// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowProTest;

public class KnowProContext
{
    public KnowProContext(string? basePath = null)
    {
        this.BasePath = basePath ?? "/data/testChat/knowpro";
        this.DotnetPath = Path.Join(this.BasePath, "dotnet");
        Directory.CreateDirectory(this.BasePath);
        Directory.CreateDirectory(this.DotnetPath);
    }

    public string BasePath { get; set; }
    public string DotnetPath { get; set; }
}
