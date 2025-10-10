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

    public override string ToString()
    {
        string term = Term.ToString();
        if (!RelatedTerms.IsNullOrEmpty())
        {
            term = $"{term}\n<\n{RelatedTerms.Join("\n")}>";
        }
        return term;
    }

    public bool IsWildcard()
    {
        return Term.Text == "*";
    }

    public static implicit operator SearchTerm(string value)
    {
        return new SearchTerm(value);
    }
}
