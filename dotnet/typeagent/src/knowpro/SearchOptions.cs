// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SearchOptions
{
    public SearchOptions()
    {
        InitDefault();
    }

    public SearchOptions(SearchOptions options)
    {
        ArgumentVerify.ThrowIfNull(options, nameof(options));

        MaxKnowledgeMatches = options.MaxKnowledgeMatches;
        MaxMessageMatches = options.MaxMessageMatches;
        ExactMatch = options.ExactMatch;
        MaxCharsInBudget = options.MaxCharsInBudget;
        ThresholdScore = options.ThresholdScore;
    }

    public int? MaxKnowledgeMatches { get; set; }

    public int? MaxMessageMatches { get; set; }

    public bool? ExactMatch { get; set; }

    /// <summary>
    /// The maximum # of total message characters to select
    /// The query processor will ensure that the cumulative character count of message matches
    /// is less than this number
    /// </summary>
    public int? MaxCharsInBudget { get; set; }

    public double? ThresholdScore { get; set; }

    public virtual void InitDefault()
    {
        ExactMatch = false;
    }

    public virtual void InitTypical()
    {
        InitDefault();

        MaxKnowledgeMatches = 50;
        MaxMessageMatches = 25;
    }

    public static SearchOptions CreateDefault()
    {
        return new SearchOptions();
    }

    public static SearchOptions CreateTypical()
    {
        var options = new SearchOptions();
        options.InitTypical();
        return options;
    }
}
