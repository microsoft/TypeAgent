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
        context.KnowledgeMatches = await SrcExpr.EvalAsync(
            context
        ).ConfigureAwait(false);

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
                // TODO: This can retrieve TextRanges only, not entire SemanticRefs. 
                var semanticRefs = await context.SemanticRefs.GetAsync(
                    knowledgeMatches.SemanticRefMatches
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
        var messageCountInBudget = await context.Conversation.Messages.GetCountInCharBudgetAsync(
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
        var matches = await SrcExpr.EvalAsync(
            context
        ).ConfigureAwait(false);

        return matches.ToScoredOrdinals();
    }
}

internal class MatchMessagesBySimilarityExpr : QueryOpExpr<IList<ScoredMessageOrdinal>>
{
    public MatchMessagesBySimilarityExpr(
        string queryText,
        int? maxMessages = null,
        double? minScore = null,
        GetScopeExpr? getScopeExpr = null
    )
        : base()
    {
        ArgumentVerify.ThrowIfNullOrEmpty(queryText, nameof(queryText));
        QueryText = queryText;
        MaxMessages = maxMessages;
        MinScore = minScore;
        GetScopeExpr = getScopeExpr;
    }

    public string QueryText { get; }

    public int? MaxMessages { get; }

    public double? MinScore { get; }

    public GetScopeExpr? GetScopeExpr { get; }

    public override async ValueTask<IList<ScoredMessageOrdinal>> EvalAsync(QueryEvalContext context)
    {
        if (GetScopeExpr is not null)
        {
            context.TextRangesInScope = await GetScopeExpr.EvalAsync(context);
        }

        var rangesInScope = context.TextRangesInScope;
        Func<int, bool> predicate = rangesInScope is not null
            ? (int messageOrdinal) => this.IsInScope(rangesInScope, messageOrdinal)
            : null;

        return await context.Conversation.SecondaryIndexes.MessageIndex.LookupMessagesAsync(
            QueryText,
            predicate,
            MaxMessages,
            MinScore
        ).ConfigureAwait(false);
    }

    private bool IsInScope(TextRangesInScope scope, int messageOrdinal)
    {
        return scope.IsRangeInScope(new TextRange(messageOrdinal));
    }
}

internal class RankMessagesBySimilarityExpr : QueryOpExpr<MessageAccumulator>
{
    public RankMessagesBySimilarityExpr(
        QueryOpExpr<MessageAccumulator> srcExpr,
        string queryText,
        int? maxMessages = null,
        double? minScore = null
    )
        : base()
    {
        ArgumentVerify.ThrowIfNullOrEmpty(queryText, nameof(queryText));

        QueryText = queryText;
        SrcExpr = srcExpr;
        MaxMessages = maxMessages;
        MinScore = minScore;
    }

    public QueryOpExpr<MessageAccumulator> SrcExpr { get; }

    public string QueryText { get; }

    public int? MaxMessages { get; }

    public double? MinScore { get; }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        var matches = await SrcExpr.EvalAsync(
            context
        ).ConfigureAwait(false);

        if (MaxMessages is not null && matches.Count <= MaxMessages.Value)
        {
            return matches;
        }
        //
        // If the messageIndex supports re-ranking by similarity, we will try that as
        // a secondary way of picking relevant messages
        //
        var messageIndex = context.Conversation.SecondaryIndexes.MessageIndex;
        List<int> messageOrdinals = matches.ToValues();

        matches.Clear();

        IList<ScoredMessageOrdinal> rankedMessages = await messageIndex.LookupMessagesInSubsetAsync(
            QueryText,
            messageOrdinals,
            MaxMessages,
            MinScore
        ).ConfigureAwait(false);

        foreach (var match in rankedMessages)
        {
            matches.Add(match.MessageOrdinal, match.Score);
        }
        return matches;
    }
}


