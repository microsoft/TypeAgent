// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SearchSelectExpr
{
    public SearchSelectExpr(SearchTermGroup searchTermGroup)
        : this(searchTermGroup, null)
    {

    }

    public SearchSelectExpr(SearchTermGroup searchTermGroup, WhenFilter when)
    {
        ArgumentVerify.ThrowIfNull(searchTermGroup, nameof(searchTermGroup));
        SearchTermGroup = searchTermGroup;
        When = when;
    }

    public SearchTermGroup SearchTermGroup { get; }

    public WhenFilter? When { get; set; }
}
