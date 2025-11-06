// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public interface ISearchTerm
{

}

public class SearchTerm : ISearchTerm
{
    public SearchTerm(string term)
        : this(new Term(term), false)
    {
    }

    public SearchTerm(Term term, bool exactMatch)
    {
        ArgumentVerify.ThrowIfNull(term, nameof(term));
        Term = term;
        RelatedTermsRequired = false;
        if (exactMatch)
        {
            RelatedTerms = Array.Empty<Term>();
        }
    }

    /// <summary>
    /// Term being searched for
    /// </summary>
    public Term Term { get; }

    /// <summary>
    ///  Additional terms related to term.
    /// </summary>
    public IList<Term>? RelatedTerms { get; set; }

    public bool IsExactMatch() => RelatedTerms is not null && RelatedTerms.Count == 0;

    public override string ToString()
    {
        string term = Term.ToString();
        if (!RelatedTerms.IsNullOrEmpty())
        {
            term = $"{term} <<{RelatedTerms.Join("; ")}>>";
        }
        return term;
    }

    public bool IsWildcard() => Term.Text.IsWildcard();

    public void AddRelated(Term term)
    {
        ArgumentVerify.ThrowIfNull(term, nameof(term));
        RelatedTerms ??= [];
        RelatedTerms.Add(term);
    }

    internal bool RelatedTermsRequired { get; set; }

    /*
    internal SearchTerm Clone()
    {
        return new SearchTerm(Term);
    }
    */
    internal SearchTerm ToRequired()
    {
        RelatedTermsRequired = true;
        return this;
    }

    public static implicit operator SearchTerm(string value)
    {
        return new SearchTerm(value);
    }
}

