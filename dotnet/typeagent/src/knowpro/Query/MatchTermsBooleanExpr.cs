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
            context.TextRangesInScope = await GetScopeExpr.EvalAsync(context).ConfigureAwait(false);
        }
        context.ClearMatchedTerms();
    }

    public static QueryOpExpr<SemanticRefAccumulator> CreateMatchTermsBooleanExpr(
        IList<QueryOpExpr<SemanticRefAccumulator>> termExpressions,
        SearchTermBooleanOp booleanOp,
        GetScopeExpr? scopeExpr
    )
    {
        return booleanOp switch
        {
            SearchTermBooleanOp.And => new MatchTermsAndExpr(termExpressions, scopeExpr),
            SearchTermBooleanOp.Or => new MatchTermsOrExpr(termExpressions, scopeExpr),
            SearchTermBooleanOp.OrMax => new MatchTermsOrMaxExpr(termExpressions, scopeExpr),
            _ => throw new NotSupportedException(),
        };
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

    public IList<QueryOpExpr<SemanticRefAccumulator?>> TermExpressions { get; }

    public override async ValueTask<SemanticRefAccumulator> EvalAsync(QueryEvalContext context)
    {
        await BeginMatchAsync(context);

        SemanticRefAccumulator? allMatches = null;
        foreach (var termExpr in TermExpressions)
        {
            var termMatches = await termExpr.EvalAsync(context).ConfigureAwait(false);
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
        SemanticRefAccumulator matches = await base.EvalAsync(context).ConfigureAwait(false);
        int maxHitCount = matches.GetMaxHitCount();
        if (maxHitCount > 1)
        {
            matches.SelectWithHitCount(maxHitCount);
        }
        return matches;
    }
}

internal class MatchTermsAndExpr : MatchTermsBooleanExpr
{
    public MatchTermsAndExpr(
        IList<QueryOpExpr<SemanticRefAccumulator?>> termExpressions,
        GetScopeExpr? getScopeExpr
    )
        : base(getScopeExpr)
    {
        ArgumentVerify.ThrowIfNull(termExpressions, nameof(termExpressions));
        TermExpressions = termExpressions;
    }

    public IList<QueryOpExpr<SemanticRefAccumulator?>> TermExpressions { get; }

    public override async ValueTask<SemanticRefAccumulator> EvalAsync(QueryEvalContext context)
    {
        await base.BeginMatchAsync(context);

        SemanticRefAccumulator? allMatches = null;
        int iTerm = 0;
        // Loop over each search term, intersecting the returned results...
        for (; iTerm < TermExpressions.Count; ++iTerm)
        {
            var termExpr = TermExpressions[iTerm];
            SemanticRefAccumulator? termMatches = await termExpr.EvalAsync(context).ConfigureAwait(false);
            if (termMatches is null || termMatches.Count == 0)
            {
                // We can't possibly have an 'and'
                break;
            }
            allMatches = allMatches is null ? termMatches : allMatches.Intersect(termMatches);
        }
        if (allMatches is not null)
        {
            if (iTerm == TermExpressions.Count)
            {
                allMatches.CalculateTotalScore();
                allMatches.SelectWithHitCount(TermExpressions.Count);
            }
            else
            {
                // And is not possible
                allMatches.Clear();
            }
        }
        return allMatches ?? new SemanticRefAccumulator();
    }
}
