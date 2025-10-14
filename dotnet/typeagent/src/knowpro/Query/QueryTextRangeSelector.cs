// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

/**
 * Query Text Range selectors return TextRangeCollections
 * These are typically used to determine the scope for a query
 */
internal interface IQueryTextRangeSelector
{
    ValueTask<TextRangeCollection?> EvalAsync(QueryEvalContext context, SemanticRefAccumulator? semanticRefs = null);
}
