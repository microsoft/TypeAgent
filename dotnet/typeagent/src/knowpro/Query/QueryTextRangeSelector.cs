// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal interface IQueryTextRangeSelector
{
    ValueTask<TextRangeCollection?> EvalAsync(QueryEvalContext context);
}

internal class QueryTextRangeSelector : QueryOpExpr<TextRangeCollection>, IQueryTextRangeSelector
{
    public QueryTextRangeSelector(IList<TextRange> rangesInScope)
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
    public TextRangesInDateRangeSelector(DateRange dateRangeInScope)
    {
        DateRangeInScope = dateRangeInScope;
    }

    public DateRange DateRangeInScope { get; }

    public override async ValueTask<TextRangeCollection> EvalAsync(QueryEvalContext context)
    {
        var textRangesInScope = new TextRangeCollection();

        IList<TimestampedTextRange> textRanges = await context.TimestampIndex.LookupRangeAsync(
            DateRangeInScope
        ).ConfigureAwait(false);

        foreach (var timeRange in textRanges)
        {
            textRangesInScope.Add(timeRange.Range);
        }
        return textRangesInScope;
    }
}

internal class TextRangesFromMessagesSelector : QueryOpExpr<TextRangeCollection>, IQueryTextRangeSelector
{
    public TextRangesFromMessagesSelector(QueryOpExpr<MessageAccumulator> sourceExpr)
    {
        ArgumentVerify.ThrowIfNull(sourceExpr, nameof(sourceExpr));
        SourceExpr = sourceExpr;
    }

    public QueryOpExpr<MessageAccumulator> SourceExpr { get; }

    public override async ValueTask<TextRangeCollection> EvalAsync(QueryEvalContext context)
    {
        var matches = await SourceExpr.EvalAsync(context).ConfigureAwait(false);
        List<TextRange> rangesInScope;
        if (matches.Count > 0)
        {
            List<int> allOrdinals = [.. matches.GetMatchedValues()];
            allOrdinals.Sort();
            rangesInScope = allOrdinals.Map((ordinal) => new TextRange(ordinal));
        }
        else
        {
            rangesInScope = [];
        }
        return new TextRangeCollection(rangesInScope);
    }
}
