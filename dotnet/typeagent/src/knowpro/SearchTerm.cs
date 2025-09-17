// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SearchTerm
{
    /// <summary>
    /// Term being searched for
    /// </summary>
    public Term Term { get; set; }
    /// <summary>
    ///  Additional terms related to term.
    /// </summary>
    public Term[]? RelatedTerms { get; set; }
}
