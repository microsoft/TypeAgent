// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public class SearchSelectExpr
{
    public SearchSelectExpr(SearchTermGroup searchTermGroup)
        : this(searchTermGroup, null)
    {

    }

    public SearchSelectExpr(SearchTermGroup searchTermGroup, WhenFilter? when)
    {
        ArgumentVerify.ThrowIfNull(searchTermGroup, nameof(searchTermGroup));
        SearchTermGroup = searchTermGroup;
        When = when;
    }

    public SearchTermGroup SearchTermGroup { get; }

    public WhenFilter? When { get; set; }

    public override string ToString()
    {
        // TODO: pretty printer
        StringBuilder sb = new StringBuilder();
        sb.Append(SearchTermGroup.ToString());
        sb.Append(Environment.NewLine);
        sb.Append(When?.ToString());

        return sb.ToString();
    }
}
