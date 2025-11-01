// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SearchOptions
{
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

    public static SearchOptions CreateDefault()
    {
        return new SearchOptions()
        {
            ExactMatch = false
        };
    }

    public static SearchOptions CreateTypical()
    {
        var options = CreateDefault();
        options.MaxKnowledgeMatches = 50;
        options.MaxMessageMatches = 25;
        return options;
    }
}
