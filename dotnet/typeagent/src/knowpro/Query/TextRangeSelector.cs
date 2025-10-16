// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal interface IQueryTextRangeSelector
{
    ValueTask<TextRangeCollection?> EvalAsync(QueryEvalContext context);
}

internal class TextRangeSelector : QueryOpExpr<TextRangeCollection>, IQueryTextRangeSelector
{
    public TextRangeSelector(IList<TextRange> rangesInScope)
    {
        TextRangesInScope = new TextRangeCollection([.. rangesInScope]);
        TextRangesInScope.Sort();
    }

    public TextRangeCollection TextRangesInScope { get; }

    public override ValueTask<TextRangeCollection> EvalAsync(QueryEvalContext context)
    {
        return ValueTask.FromResult(TextRangesInScope);
    }
}
