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

internal class TextRangesInDateRangeSelector : QueryOpExpr<TextRangeCollection>, IQueryTextRangeSelector
{
    public TextRangesInDateRangeSelector (DateRange dateRangeInScope)
    {
        DateRangeInScope = dateRangeInScope;
    }

    public DateRange DateRangeInScope { get; }

    public override async ValueTask<TextRangeCollection> EvalAsync(QueryEvalContext context)
    {
        var textRangesInScope = new TextRangeCollection();

        IList<TimestampedTextRange> textRanges = await context.TimestampIndex.LookupRangeAsync(DateRangeInScope);
        foreach (var timeRange in textRanges)
        {
            textRangesInScope.Add(timeRange.Range);
        }
        return textRangesInScope;
    }
}
