// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class GetScopeExpr : QueryOpExpr<TextRangesInScope>
{
    public GetScopeExpr(IList<TextRangeSelector> rangeSelectors)
        : base()
    {
        ArgumentVerify.ThrowIfNull(rangeSelectors, nameof(rangeSelectors));
        RangeSelectors = rangeSelectors;
    }

    public IList<TextRangeSelector> RangeSelectors { get; }

    public override async ValueTask<TextRangesInScope> EvalAsync(QueryEvalContext context)
    {
        var rangesInScope = new TextRangesInScope();
        foreach (var selector in RangeSelectors)
        {
            TextRangeCollection? range = await selector.EvalAsync(context).ConfigureAwait(false);
            if (range is not null)
            {
                rangesInScope.AddTextRanges(range);
            }
        }
        return rangesInScope;
    }
}
