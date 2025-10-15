// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class MatchMessagesBooleanExpr : QueryOpExpr<MessageAccumulator>
{
    public MatchMessagesBooleanExpr(IList<QueryOpExpr> termExpressions)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(termExpressions, nameof(termExpressions));

        TermExpressions = termExpressions;
    }

    public IList<QueryOpExpr> TermExpressions { get; }


    public static MatchMessagesBooleanExpr Create(
        IList<QueryOpExpr> termExpressions,
        SearchTermBooleanOp booleanOp
    )
    {
        return booleanOp switch
        {
            SearchTermBooleanOp.And => new MatchMessagesAndExpr(termExpressions),
            SearchTermBooleanOp.Or => new MatchMessagesOrExpr(termExpressions),
            SearchTermBooleanOp.OrMax => new MatchMessagesOrMaxExpr(termExpressions),
            _ => throw new NotSupportedException(),
        };
    }

    protected void BeginMatch(QueryEvalContext context)
    {
        context.ClearMatchedTerms();
    }

    protected async ValueTask<MessageAccumulator?> AccumulateMessagesAsync(QueryEvalContext context, object? matches)
    {
        MessageAccumulator? messageMatches = null;
        if (matches is not null)
        {
            if (matches is SemanticRefAccumulator sra)
            {
                if (sra.Count > 0)
                {
                    messageMatches = await AccumulateMessagesAsync(context, sra).ConfigureAwait(false);
                }
            }
            else if (matches is MessageAccumulator ma)
            {
                messageMatches = ma;
            }
        }
        return messageMatches;
    }

    protected async ValueTask<MessageAccumulator> AccumulateMessagesAsync(QueryEvalContext context, SemanticRefAccumulator semanticRefMatches)
    {
        var messageMatches = new MessageAccumulator();
        IList<SemanticRef> semanticRefs = await context.SemanticRefs.GetAsync(
            semanticRefMatches.ToOrdinals()
        ).ConfigureAwait(false);
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
    public MatchMessagesOrExpr(IList<QueryOpExpr> termExpressions)
        : base(termExpressions)
    {
    }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        BeginMatch(context);

        MessageAccumulator? allMatches = null;
        foreach (var termExpr in TermExpressions)
        {
            var matches = await termExpr.GetResultAsync(context).ConfigureAwait(false);
            if (matches is null)
            {
                continue;
            }

            MessageAccumulator? messageMatches = await AccumulateMessagesAsync(context, matches).ConfigureAwait(false);
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

internal class MatchMessagesAndExpr : MatchMessagesBooleanExpr
{
    public MatchMessagesAndExpr(IList<QueryOpExpr> termExpressions)
        : base(termExpressions)
    {
    }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        BeginMatch(context);

        MessageAccumulator? allMatches = null;
        int iTerm = 0;

        int count = TermExpressions.Count;
        for (; iTerm < count; ++iTerm)
        {
            var matches = await TermExpressions[iTerm].GetResultAsync(context).ConfigureAwait(false);
            if (matches is null)
            {
                // We can't possibly have an 'and'
                break;
            }
            var messageMatches = await AccumulateMessagesAsync(context, matches).ConfigureAwait(false);
            if (messageMatches is null)
            {
                // Can't possibly be an 'and'
                break;
            }

            if (allMatches is null)
            {
                allMatches = messageMatches;
            }
            else
            {
                allMatches = allMatches.Intersect(messageMatches);
                if (allMatches.Count == 0)
                {
                    // we can't possibly have an 'and'
                    break;
                }
            }
        }

        if (allMatches is not null && allMatches.Count > 0)
        {
            if (iTerm == TermExpressions.Count)
            {
                // And happened only if all expressions matched
                allMatches.CalculateTotalScore();
                allMatches.SelectWithHitCount(TermExpressions.Count);
            }
            else
            {
                // And is not possible
                allMatches.Clear();
            }
        }
        return allMatches ?? new MessageAccumulator();
    }
}

internal class MatchMessagesOrMaxExpr : MatchMessagesOrExpr
{
    public MatchMessagesOrMaxExpr(IList<QueryOpExpr> termExpressions)
        : base(termExpressions)
    {
    }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        var matches = await base.EvalAsync(context).ConfigureAwait(false);
        var maxHitCount = matches.GetMaxHitCount();
        if (maxHitCount > 1)
        {
            matches.SelectWithHitCount(maxHitCount);
        }
        return matches;
    }
}
