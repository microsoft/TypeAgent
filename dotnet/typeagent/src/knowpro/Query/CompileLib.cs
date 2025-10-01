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
    public CompiledTermGroup(SearchTermBooleanOp booleanOp)
    {
        ArgumentVerify.ThrowIfNull(booleanOp, nameof(booleanOp));
        BooleanOp = booleanOp;
        Terms = [];
    }

    public SearchTermBooleanOp BooleanOp { get; set; }

    public IList<CompiledSearchTerm> Terms { get; set; }
};
