// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class WhenFilter
{
    public KnowledgeType? KnowledgeType { get; set; }

    public DateRange? DateRange { get; set; }

    public IList<string>? Tags { get; set; }

    public SearchTermGroup? TagMatchingTerms { get; set; }

    public SearchTermGroup? ScopeDefiningTerms { get; set; }

    public IList<TextRange>? TextRangesInScope { get; set; }

    public string? ThreadDescription { get; set; }
}
