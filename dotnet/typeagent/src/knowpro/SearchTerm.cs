// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ISearchTerm
{

}

public class SearchTerm : ISearchTerm
{
    public SearchTerm(string term)
        : this(new Term(term))
    {

    }
    public SearchTerm(Term term)
    {
        ArgumentVerify.ThrowIfNull(term, nameof(term));
        Term = term;
    }

    /// <summary>
    /// Term being searched for
    /// </summary>
    public Term Term { get; }

    /// <summary>
    ///  Additional terms related to term.
    /// </summary>
    public IList<Term>? RelatedTerms { get; set; }


    public static implicit operator SearchTerm(string value)
    {
        return new SearchTerm(value);
    }
}
