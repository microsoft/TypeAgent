// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Query;

internal class MatchTermsBooleanExpr : QueryOpExpr<SemanticRefAccumulator>
{
    public MatchTermsBooleanExpr(GetScopeExpr? getScopeExpr)
    {
        GetScopeExpr = getScopeExpr;
    }

    public GetScopeExpr? GetScopeExpr { get; }

    protected async ValueTask BeginMatchAsync(QueryEvalContext context)
    {
        if (GetScopeExpr is not null)
        {
            context.TextRangesInScope = await GetScopeExpr.EvalAsync(context);
        }
        context.ClearMatchedTerms();
    }

    public static QueryOpExpr<SemanticRefAccumulator> CreateMatchTermsBooleanExpr(
        IList<QueryOpExpr<SemanticRefAccumulator>> termExpressions,
        SearchTermBooleanOp booleanOp,
        GetScopeExpr? scopeExpr
    )
    {
        switch (booleanOp)
        {
            case SearchTermBooleanOp.And:
                break;

            case SearchTermBooleanOp.Or:
                return new MatchTermsOrExpr(termExpressions, scopeExpr);

            case SearchTermBooleanOp.OrMax:
                return new MatchTermsOrMaxExpr(termExpressions, scopeExpr);
        }
        throw new NotSupportedException();
    }

}


internal class MatchTermsOrExpr : MatchTermsBooleanExpr
{
    public MatchTermsOrExpr(
        IList<QueryOpExpr<SemanticRefAccumulator?>> termExpressions,
        GetScopeExpr? getScopeExpr
    )
        : base(getScopeExpr)
    {
        ArgumentVerify.ThrowIfNull(termExpressions, nameof(termExpressions));
        TermExpressions = termExpressions;
    }

    public IList<QueryOpExpr<SemanticRefAccumulator>> TermExpressions { get; }

    public override async ValueTask<SemanticRefAccumulator> EvalAsync(QueryEvalContext context)
    {
        await BeginMatchAsync(context);

        SemanticRefAccumulator? allMatches = null;
        foreach (var termExpr in TermExpressions)
        {
            var termMatches = await termExpr.EvalAsync(context);
            if (termMatches is not null && termMatches.Count > 0)
            {
                if (allMatches is not null)
                {
                    allMatches.AddUnion(termMatches);
                }
                else
                {
                    allMatches = termMatches;
                }
            }
        }

        allMatches?.CalculateTotalScore();

        return allMatches ?? new SemanticRefAccumulator();
    }
}

internal class MatchTermsOrMaxExpr : MatchTermsOrExpr
{
    public MatchTermsOrMaxExpr(
        IList<QueryOpExpr<SemanticRefAccumulator?>> termExpressions,
        GetScopeExpr? getScopeExpr
    )
        : base(termExpressions, getScopeExpr)
    {
    }

    public override async ValueTask<SemanticRefAccumulator> EvalAsync(QueryEvalContext context)
    {
        var matches = await base.EvalAsync(context);
        int maxHitCount = matches.GetMaxHitCount();
        if (maxHitCount > 1)
        {
            matches.SelectWithHitCount(maxHitCount);
        }
        return matches;
    }
}
