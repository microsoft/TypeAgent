// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SearchTermGroup : ISearchTerm
{
    public SearchTermGroup(SearchTermBooleanOp booleanOp)
    {
        ArgumentVerify.ThrowIfNull(booleanOp, nameof(booleanOp));
        BooleanOp = booleanOp;
        Terms = [];
    }

    public SearchTermBooleanOp BooleanOp { get; private set; }

    public IList<ISearchTerm> Terms { get; set; }

}

public enum SearchTermBooleanOp
{
    Or,
    OrMax,
    And
}
