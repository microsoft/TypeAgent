// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

/**
 * A Search Query expr consists:
 *  - A set of select expressions to evaluate against structured data
 *  - The raw natural language search query. This may be used to do a
 *  non-structured query
 */
public struct SearchQueryExpr
{
    public SearchQueryExpr()
    {
        SelectExpressions = [];
    }

    public List<SearchSelectExpr> SelectExpressions { get; }

    public string? RawQuery { get; set; }
};
