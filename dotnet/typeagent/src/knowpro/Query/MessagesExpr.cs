// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Query;

internal class MessagesFromKnowledgeExpr : QueryOpExpr<MessageAccumulator>
{
    internal MessagesFromKnowledgeExpr(
        QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> srcExpr
    )
    {
        ArgumentVerify.ThrowIfNull(srcExpr, nameof(srcExpr));
        SrcExpr = srcExpr;
    }

    public QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> SrcExpr { get; }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        context.KnowledgeMatches = await SrcExpr.EvalAsync(context);
        var messages = new MessageAccumulator();
        if (!context.KnowledgeMatches.IsNullOrEmpty())
        {
        }
        return messages;
    }
}

internal class SelectMessagesInCharBudget : QueryOpExpr<MessageAccumulator>
{
    public SelectMessagesInCharBudget(QueryOpExpr<MessageAccumulator> srcExpr, int maxCharsInBudget)
        : base()
    {
        ArgumentVerify.ThrowIfNull(srcExpr, nameof(srcExpr));
        SrcExpr = srcExpr;
        MaxCharsInBudget = maxCharsInBudget;
    }

    public QueryOpExpr<MessageAccumulator> SrcExpr { get; }
    public int MaxCharsInBudget { get; }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        var matches = await SrcExpr.EvalAsync(context);

        var scoredMatches = matches.GetSortedByScore();
        var sortedOrdinals = scoredMatches.Map((m) => m.Value);
        var messageCountInBudget = await context.Messages.GetCountInCharBudgetAsync(
            sortedOrdinals,
            MaxCharsInBudget
        ).ConfigureAwait(false);
        matches.Clear();
        if (messageCountInBudget > 0)
        {
            scoredMatches = scoredMatches.GetRange(0, messageCountInBudget);
            matches.SetMatches(scoredMatches);
        }
        return matches;
    }
}

internal class GetScoredMessagesExpr : QueryOpExpr<List<ScoredMessageOrdinal>>
{
    public GetScoredMessagesExpr(QueryOpExpr<MessageAccumulator> srcExpr)
        : base()
    {
    }

    public QueryOpExpr<MessageAccumulator> SrcExpr { get; }

    public override async ValueTask<List<ScoredMessageOrdinal>> EvalAsync(QueryEvalContext context)
    {
        var matches = await SrcExpr.EvalAsync(context);
        return matches.ToScoredOrdinals();
    }
}
