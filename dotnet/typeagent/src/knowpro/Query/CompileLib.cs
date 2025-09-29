// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class CompiledSearchTerm : SearchTerm
{
    public CompiledSearchTerm(SearchTerm searchTerm, bool relatedTermsRequired)
        : base(searchTerm.Term)
    {
        RelatedTerms = searchTerm.RelatedTerms;
        RelatedTermsRequired = relatedTermsRequired;
    }

    public bool RelatedTermsRequired { get; }
}

internal class CompiledTermGroup
{
    public SearchTermBooleanOp BooleanOp { get; set; }

    public IList<CompiledSearchTerm> Terms { get; set; }
};
