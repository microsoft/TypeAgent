// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SearchTermGroup : ISearchTerm
{
    public SearchTermGroup(SearchTermBooleanOp booleanOp, IList<ISearchTerm>? terms = null)
    {
        ArgumentVerify.ThrowIfNull(booleanOp, nameof(booleanOp));
        BooleanOp = booleanOp;
        Terms = terms ?? [];
    }

    public SearchTermBooleanOp BooleanOp { get; }

    public IList<ISearchTerm> Terms { get; set; }

    public bool IsEmpty => Terms.IsNullOrEmpty();

    public void Add(string term, bool exactMatch = false)
    {
        Terms.Add(new SearchTerm(term, exactMatch));
    }

    public void Add(KnowledgePropertyName propertyName, string value, bool exactMatch = false)
    {
        Terms.Add(new PropertySearchTerm(propertyName, new SearchTerm(value, exactMatch)));
    }

    public void Add(KnowledgePropertyName propertyName, IEnumerable<string> values, bool exactMatch = false)
    {
        ArgumentVerify.ThrowIfNull(values, nameof(values));

        foreach (string value in values)
        {
            Terms.Add(new PropertySearchTerm(propertyName, new SearchTerm(value, exactMatch)));
        }
    }

    public override string ToString()
    {
        return $"{BooleanOp} ({Terms.Join()})";
    }
}

public enum SearchTermBooleanOp
{
    Or,
    OrMax,
    And
}
