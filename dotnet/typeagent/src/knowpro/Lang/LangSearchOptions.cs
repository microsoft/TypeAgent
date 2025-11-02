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

    public LangQueryCompilerSettings CompilerSettings { get; internal set; }

    public LangSearchRagOptions? FallbackRagOptions { get; set; }

    public IList<PromptSection>? ModelInstructions { get; set; }

    internal SearchOptions CreateTextQueryOptions()
    {
        SearchOptions options = new SearchOptions(this);
        if (FallbackRagOptions is not null)
        {
            options.MaxMessageMatches = FallbackRagOptions.MaxMessageMatches;
            options.MaxCharsInBudget = FallbackRagOptions.MaxCharsInBudget;
            options.ExactMatch = FallbackRagOptions.ExactMatch;
        }
        return options;
    }

    public static new LangSearchOptions CreateDefault() => new LangSearchOptions();
}
