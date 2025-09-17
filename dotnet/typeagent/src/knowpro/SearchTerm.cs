// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ISearchTerm
{

}

public class SearchTerm : ISearchTerm
{
    /// <summary>
    /// Term being searched for
    /// </summary>
    public Term Term { get; set; }
    /// <summary>
    ///  Additional terms related to term.
    /// </summary>
    public IList<Term>? RelatedTerms { get; set; }
}
