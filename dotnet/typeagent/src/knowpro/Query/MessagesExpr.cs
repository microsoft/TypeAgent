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

    public bool IntersectKnowlegeTypes { get; set; } = true;

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        context.KnowledgeMatches = await SrcExpr.EvalAsync(context).ConfigureAwait(false);

        var messageMatches = new MessageAccumulator();
        if (context.KnowledgeMatches.IsNullOrEmpty())
        {
            return messageMatches;
        }
        int knowledgeTypeHitCount = 0; // How many types of knowledge matched? (e.g. entity, topic, action)
        foreach (var kv in context.KnowledgeMatches)
        {
            var knowledgeType = kv.Key;
            var knowledgeMatches = kv.Value;
            if (!knowledgeMatches.SemanticRefMatches.IsNullOrEmpty())
            {
                knowledgeTypeHitCount++;
                var semanticRefs = await context.SemanticRefs.GetAsync(
                    knowledgeMatches.SemanticRefMatches.ToOrdinals()
                ).ConfigureAwait(false);
                int count = semanticRefs.Count;
                for (int i = 0; i < count; ++i)
                {
                    messageMatches.AddFromSemanticRef(semanticRefs[i], knowledgeMatches.SemanticRefMatches[i].Score);
                }
            }
        }
        if (IntersectKnowlegeTypes && knowledgeTypeHitCount > 0)
        {
            // This basically intersects the sets of messages that matched each knowledge type
            // E.g. if topics and entities matched, then a relevant message must have both matching topics and entities
            var relevantMessages = messageMatches.GetWithHitCount(knowledgeTypeHitCount);
            if (relevantMessages.Count > 0)
            {
                messageMatches = new MessageAccumulator(relevantMessages);
            }
        }
        messageMatches.SmoothScores();
        return messageMatches;
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
        var matches = await SrcExpr.EvalAsync(context).ConfigureAwait(false);

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
        ArgumentVerify.ThrowIfNull(srcExpr, nameof(srcExpr));
        SrcExpr = srcExpr;
    }

    public QueryOpExpr<MessageAccumulator> SrcExpr { get; }

    public override async ValueTask<List<ScoredMessageOrdinal>> EvalAsync(QueryEvalContext context)
    {
        var matches = await SrcExpr.EvalAsync(context);
        return matches.ToScoredOrdinals();
    }
}
