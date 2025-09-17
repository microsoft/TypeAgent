// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class WhenFilter
{
    public KnowledgeType? KnowledgeType { get; set; }
    public DateRange? DateRange { get; set; }
    public string[]? Tags { get; set; }
    public SearchTermGroup? TagMatchingTerms { get; set; }
    public SearchTermGroup? ScopeDefiningTerms { get; set; }
    public TextRange[]? TextRangesInScope { get; set; }
}
