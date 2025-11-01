// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public class LangSearchOptions : SearchOptions
{
    public LangSearchOptions()
        : base()
    {
        CompilerSettings = new();
    }

    public LangQueryCompilerSettings CompilerSettings { get; }

    public LangSearchRagOptions? FallbackRagOptions { get; set; }

    public IList<PromptSection>? ModelInstructions { get; set; }
}
