// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class MatchMessagesBooleanExpr : QueryOpExpr<MessageAccumulator>
{
    public MatchMessagesBooleanExpr(IList<QueryOpExpr<object?>> termExpressions)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(termExpressions, nameof(termExpressions));

        TermExpressions = termExpressions;
    }

    public IList<QueryOpExpr<object?>> TermExpressions { get; }


    protected void BeginMatch(QueryEvalContext context)
    {
        context.ClearMatchedTerms();
    }

    protected async ValueTask<MessageAccumulator> AccumulateMessagesAsync(
        QueryEvalContext context,
        SemanticRefAccumulator semanticRefMatches
    )
    {
        var messageMatches = new MessageAccumulator();
        IList<SemanticRef> semanticRefs = await context.SemanticRefs.GetAsync(semanticRefMatches.ToOrdinals());
        int i = 0;
        foreach (var match in semanticRefMatches.GetMatches())
        {
            messageMatches.AddFromSemanticRef(semanticRefs[i], match.Score);
            ++i;
        }
        return messageMatches;
    }
}

internal class MatchMessagesOrExpr : MatchMessagesBooleanExpr
{
    public MatchMessagesOrExpr(IList<QueryOpExpr<object?>> termExpressions)
        : base(termExpressions)
    {
    }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        BeginMatch(context);
        MessageAccumulator? allMatches = null;
        foreach (var termExpr in TermExpressions) {
            var matches = await termExpr.EvalAsync(context);
            if (matches is null)
            {
                continue;
            }

            MessageAccumulator? messageMatches = null;
            if (matches is SemanticRefAccumulator sra)
            {
                if (sra.Count > 0)
                {
                    messageMatches = await AccumulateMessagesAsync(context, sra);
                }
            }
            else if (matches is MessageAccumulator ma)
            {
                messageMatches = ma;
            }
            if (messageMatches is not null)
            {
                if (allMatches is not null)
                {
                    allMatches.AddUnion(messageMatches);
                }
                else
                {
                    allMatches = messageMatches;
                }
            }
        }
        allMatches?.CalculateTotalScore();
        return allMatches ?? new MessageAccumulator();
    }
}
