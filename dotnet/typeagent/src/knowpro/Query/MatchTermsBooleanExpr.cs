// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Query;

internal class MatchTermsBooleanExpr : QueryOpExpr<SemanticRefAccumulator>
{
    protected void BeginMatch(QueryEvalContext context)
    {
        context.ClearMatchedTerms();
    }

    public static QueryOpExpr<SemanticRefAccumulator> CreateMatchTermsBooleanExpr(
        IList<QueryOpExpr<SemanticRefAccumulator>> termExpressions,
        SearchTermBooleanOp booleanOp
    )
    {
        switch (booleanOp)
        {
            case SearchTermBooleanOp.And:
                break;

            case SearchTermBooleanOp.Or:
                return new MatchTermsOrExpr(termExpressions);

            case SearchTermBooleanOp.OrMax:
                break;
        }
        throw new NotSupportedException();
    }

}


internal class MatchTermsOrExpr : MatchTermsBooleanExpr
{
    public MatchTermsOrExpr(IList<QueryOpExpr<SemanticRefAccumulator?>> termExpressions)
    {
        ArgumentVerify.ThrowIfNull(termExpressions, nameof(termExpressions));

        TermExpressions = termExpressions;
    }

    public IList<QueryOpExpr<SemanticRefAccumulator>> TermExpressions { get; }

    public override async ValueTask<SemanticRefAccumulator> EvalAsync(QueryEvalContext context)
    {
        BeginMatch(context);

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
