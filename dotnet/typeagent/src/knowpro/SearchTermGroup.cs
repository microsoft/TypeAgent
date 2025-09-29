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

public readonly struct SearchTermBooleanOp
{
    public static readonly SearchTermBooleanOp Or = new SearchTermBooleanOp("or");
    public static readonly SearchTermBooleanOp OrMax = new SearchTermBooleanOp("or_max");
    public static readonly SearchTermBooleanOp And = new SearchTermBooleanOp("and");

    private SearchTermBooleanOp(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static implicit operator string(SearchTermBooleanOp propertyName)
    {
        return propertyName.Value;
    }

}
