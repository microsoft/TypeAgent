// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections;

namespace TypeAgent.KnowPro;

public class SearchTermGroup : ISearchTerm, IEnumerable<ISearchTerm>
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

    public void Add(ISearchTerm searchTerm)
    {
        ArgumentVerify.ThrowIfNull(searchTerm, nameof(searchTerm));
        Terms.Add(searchTerm);
    }

    public void Add(string term, bool exactMatch = false)
    {
        Add(new SearchTerm(term, exactMatch));
    }

    public void Add(IEnumerable<string> terms, bool exactMatch = false)
    {
        ArgumentVerify.ThrowIfNull(terms, nameof(terms));

        foreach (var term in terms)
        {
            Add(term, exactMatch);
        }
    }

    public void Add(KnowledgePropertyName propertyName, string value, bool exactMatch = false)
    {
        Add(new PropertySearchTerm(propertyName, new SearchTerm(value, exactMatch)));
    }

    public void Add(KnowledgePropertyName propertyName, IEnumerable<string> values, bool exactMatch = false)
    {
        ArgumentVerify.ThrowIfNull(values, nameof(values));

        foreach (string value in values)
        {
            Add(new PropertySearchTerm(propertyName, new SearchTerm(value, exactMatch)));
        }
    }

    public void Add(string propertyName, string propertyValue)
    {
        Add(new PropertySearchTerm(propertyName, propertyValue));
    }

    public IEnumerator<ISearchTerm> GetEnumerator()
    {
        return this.Terms.GetEnumerator();
    }

    public override string ToString()
    {
        return $"{BooleanOp} ({Terms.Join()})";
    }

    IEnumerator IEnumerable.GetEnumerator()
    {
        return ((IEnumerable)this.Terms).GetEnumerator();
    }
}

public enum SearchTermBooleanOp
{
    Or,
    OrMax,
    And
}
