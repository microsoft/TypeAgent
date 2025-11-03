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

    public LangSearchOptions(LangSearchOptions src)
        : base(src)
    {
        CompilerSettings = new LangQueryCompilerSettings(src.CompilerSettings);
        FallbackRagOptions = (src.FallbackRagOptions is not null)
            ? new LangSearchRagOptions(src.FallbackRagOptions)
            : null;
        ModelInstructions = (src.ModelInstructions is not null)
            ? new List<PromptSection>(src.ModelInstructions)
            : null;
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

    public static new LangSearchOptions CreateTypical()
    {
        var options = new LangSearchOptions();
        options.InitTypical();
        return options;
    }
}
