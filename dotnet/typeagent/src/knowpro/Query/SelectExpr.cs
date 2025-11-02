// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class SelectTopNExpr<T, TVal> : QueryOpExpr<T>
    where T : MatchAccumulator<TVal>
{
    public SelectTopNExpr(
        QueryOpExpr<T> sourceExpr,
        int? maxMatches = null,
        int? minHitCount = null
    )
    {
        ArgumentVerify.ThrowIfNull(sourceExpr, nameof(sourceExpr));

        SourceExpr = sourceExpr;
        MaxMatches = maxMatches;
        MinHitCount = minHitCount;
    }

    public QueryOpExpr<T> SourceExpr { get; }

    public int? MaxMatches { get; }

    public int? MinHitCount { get; }

    public override async ValueTask<T> EvalAsync(QueryEvalContext context)
    {
        T matches = await SourceExpr.EvalAsync(
            context
        ).ConfigureAwait(false);

        matches.SelectTopNScoring(
            MaxMatches is not null ? MaxMatches.Value : -1,
            MinHitCount is not null ? MinHitCount.Value : -1
        );
        return matches;
    }
}
