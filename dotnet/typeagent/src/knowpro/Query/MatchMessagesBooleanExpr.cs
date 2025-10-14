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

    protected async ValueTask<MessageAccumulator?> AccumulateMessagesAsync(QueryEvalContext context, object? matches)
    {
        MessageAccumulator? messageMatches = null;
        if (matches is not null)
        {
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
        }
        return messageMatches;
    }

    protected async ValueTask<MessageAccumulator> AccumulateMessagesAsync(QueryEvalContext context, SemanticRefAccumulator semanticRefMatches)
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

            MessageAccumulator? messageMatches = await AccumulateMessagesAsync(context, matches);
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
    public MatchMessagesAndExpr(IList<QueryOpExpr<object?>> termExpressions)
        : base(termExpressions)
    {
    }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        BeginMatch(context);

        MessageAccumulator? allMatches = null;
        int iTerm = 0;

        for (; iTerm < TermExpressions.Count; ++iTerm)
        {
            var matches = await TermExpressions[iTerm].EvalAsync(context);
            if (matches is null)
            {
                // We can't possibly have an 'and'
                break;
            }
            var messageMatches = await AccumulateMessagesAsync(context, matches);
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
    public MatchMessagesOrMaxExpr(IList<QueryOpExpr<object?>> termExpressions)
        : base(termExpressions)
    {
    }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        var matches = await base.EvalAsync(context);
        var maxHitCount = matches.GetMaxHitCount();
        if (maxHitCount > 1)
        {
            matches.SelectWithHitCount(maxHitCount);
        }
        return matches;
    }
}
