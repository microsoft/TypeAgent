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

    public override string ToString()
    {
        // TODO: implement
        StringBuilder sb = new();
        sb.Append("WHEN");
        sb.Append(Environment.NewLine);
        sb.Append("[ ");

        if (KnowledgeType != null)
        {
            sb.Append($" KnowledgeType: {KnowledgeType} ");
            sb.Append(Environment.NewLine);
        }

        if (DateRange != null)
        {
            sb.Append($" DateRange: {DateRange} ");
            sb.Append(Environment.NewLine);
        }

        if (Tags != null)
        {
            sb.Append(" Tags: [");
            sb.Append(string.Join(", ", Tags));
            sb.Append("] ");
        }

        if (TagMatchingTerms != null)
        {
            sb.Append($" TagMatchingTerms: {TagMatchingTerms} ");
            sb.Append(Environment.NewLine);
        }

        if (ScopeDefiningTerms != null)
        {
            sb.Append($" ScopeDefiningTerms: {ScopeDefiningTerms} ");
            sb.Append(Environment.NewLine);
        }

        if (TextRangesInScope != null)
        {
            sb.Append(" TextRangesInScope: [");
            sb.Append(string.Join(", ", TextRangesInScope));
            sb.Append("] ");
            sb.Append(Environment.NewLine);
        }

        if (ThreadDescription != null)
        {
            sb.Append($" ThreadDescription: {ThreadDescription} ");
            sb.Append(Environment.NewLine);
        }

        sb.Append("] ");
        sb.Append(Environment.NewLine);

        return sb.ToString();
    }
}
