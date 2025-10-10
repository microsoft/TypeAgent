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
