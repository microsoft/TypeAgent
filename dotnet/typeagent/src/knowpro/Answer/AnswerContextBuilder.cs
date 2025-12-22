// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

internal class AnswerContextBuilder
{
    IConversation _conversation;
    MetadataMerger _metaMerger;

    public AnswerContextBuilder(IConversation conversation)
    {
        ArgumentVerify.ThrowIfNull(conversation, nameof(conversation));

        _conversation = conversation;
        _metaMerger = new MetadataMerger();
    }

    public async ValueTask<AnswerContext> FromSearchResultAsync(
        ConversationSearchResult searchResult,
        AnswerContextOptions? options,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(searchResult, nameof(searchResult));

        if (!searchResult.HasResults)
        {
            throw new KnowProException(KnowProException.ErrorCode.EmptySearchResults);
        }

        AnswerContext context = new AnswerContext();

        foreach (var resultForType in searchResult.KnowledgeMatches)
        {
            if (resultForType.Key == KnowledgeType.Topic)
            {
                context.Topics = await GetRelevantTopicsAsync(
                    resultForType.Value,
                    options?.TopicsTopK,
                    cancellationToken
                ).ConfigureAwait(false);
            }
            else if (resultForType.Key == KnowledgeType.Entity)
            {
                context.Entities = await GetRelevantEntitiesAsync(
                    resultForType.Value,
                    options?.EntitiesTopK,
                    cancellationToken
                ).ConfigureAwait(false);
            }
        }

        context.Messages = await GetRelevantMessagesAsync(
            searchResult.MessageMatches,
            options?.MessagesTopK,
            cancellationToken
        ).ConfigureAwait(false);

        return context;
    }

    public ValueTask<IList<RelevantEntity>> GetRelevantEntitiesAsync(
        SemanticRefSearchResult searchResult,
        int? topK = null,
        CancellationToken cancellationToken = default
    )
    {
        return GetRelevantEntitiesAsync(
                searchResult.SemanticRefMatches,
                topK,
                cancellationToken
                );
    }

    public async ValueTask<IList<RelevantEntity>> GetRelevantEntitiesAsync(
        IList<ScoredSemanticRefOrdinal> semanticRefMatches,
        int? topK = null,
        CancellationToken cancellationToken = default
    )
    {
        if (semanticRefMatches.IsNullOrEmpty())
        {
            return [];
        }

        IList<Scored<SemanticRef>> semanticRefs = await _conversation.GetSemanticRefReader().GetScoredAsync(
            semanticRefMatches,
            KnowledgeType.Entity,
            cancellationToken
        ).ConfigureAwait(false);

        var mergedEntities = MergedEntity.Merge(semanticRefs, true);

        List<Scored<MergedEntity>> candidateEntities = (topK is not null && topK.Value < mergedEntities.Count)
            ? mergedEntities.Values.GetTopK(topK.Value)
            : [.. mergedEntities.Values];

        // Unique list of ordinals
        List<int> sortedOrdinals = CollectOrdinals(candidateEntities);

        EnclosingMetadata enclosingMetadata = await GetEnclosingMetadataAsync(
            sortedOrdinals,
            cancellationToken
        ).ConfigureAwait(false);

        List<RelevantEntity> relevantEntities = [];
        for (int i = 0; i < candidateEntities.Count; ++i)
        {
            MergedEntity candidateEntity = candidateEntities[i].Item;
            var relevantEntity = new RelevantEntity();
            relevantEntity.Entity = candidateEntity.ToConcrete();
            SetMetadata(relevantEntity, enclosingMetadata, candidateEntity.OrdinalMin, candidateEntity.OrdinalMax);
            relevantEntities.Add(relevantEntity);
        }
        return relevantEntities;
    }

    public ValueTask<IList<RelevantTopic>> GetRelevantTopicsAsync(
        SemanticRefSearchResult searchResult,
        int? topK = null,
        CancellationToken cancellationToken = default
    )
    {
        return GetRelevantTopicsAsync(
                searchResult.SemanticRefMatches,
                topK,
                cancellationToken
                );

    }

    public async ValueTask<IList<RelevantTopic>> GetRelevantTopicsAsync(
        IList<ScoredSemanticRefOrdinal> semanticRefMatches,
        int? topK = null,
        CancellationToken cancellationToken = default
    )
    {
        if (semanticRefMatches.IsNullOrEmpty())
        {
            return [];
        }

        IList<Scored<SemanticRef>> semanticRefs = await _conversation.GetSemanticRefReader().GetScoredAsync(
            semanticRefMatches,
            KnowledgeType.Topic,
            cancellationToken
        ).ConfigureAwait(false);

        var mergedTopics
            = MergedTopic.Merge(semanticRefs, true);

        List<Scored<MergedTopic>> candidateTopics = (topK is not null && topK.Value < mergedTopics.Count)
            ? mergedTopics.Values.GetTopK(topK.Value)
            : [.. mergedTopics.Values];

        // Unique list of ordinals
        List<int> sortedOrdinals = CollectOrdinals(candidateTopics);

        EnclosingMetadata enclosingMetadata = await GetEnclosingMetadataAsync(
            sortedOrdinals,
            cancellationToken
        ).ConfigureAwait(false);

        List<RelevantTopic> relevantTopics = [];
        for (int i = 0; i < candidateTopics.Count; ++i)
        {
            var candidateTopic = candidateTopics[i].Item;
            var relevantTopic = new RelevantTopic();
            relevantTopic.Topic = candidateTopic.Topic;
            SetMetadata(relevantTopic, enclosingMetadata, candidateTopic.OrdinalMin, candidateTopic.OrdinalMax);
            relevantTopics.Add(relevantTopic);
        }
        return relevantTopics;
    }

    public async ValueTask<IList<RelevantMessage>> GetRelevantMessagesAsync(
        IList<ScoredMessageOrdinal> messageMatches,
        int? topK = null,
        CancellationToken cancellationToken = default
    )
    {
        if (messageMatches.IsNullOrEmpty())
        {
            return [];
        }
        List<int> ordinals = messageMatches.ToMessageOrdinals(topK, true);
        IList<IMessage> messages = await _conversation.GetMessageReader().GetAsync(
            ordinals,
            cancellationToken
        ).ConfigureAwait(false);

        List<RelevantMessage> relevantMessages = [];
        foreach (var message in messages)
        {
            relevantMessages.Add(new RelevantMessage(message));
        }
        return relevantMessages;
    }

    private void SetMetadata(
        RelevantKnowledge knowledge,
        EnclosingMetadata enclosingMetadata,
        int min,
        int max
    )
    {
        int indexOfMin = enclosingMetadata.Ordinals.BinarySearch(min);
        int indexOfMax = enclosingMetadata.Ordinals.BinarySearch(max);
        Debug.Assert(indexOfMin >= 0);
        Debug.Assert(indexOfMax >= 0);

        var (origin, audience) = _metaMerger.Collect(
            enclosingMetadata.Meta[indexOfMin],
            enclosingMetadata.Meta[indexOfMax]
        );
        knowledge.Origin = OneOrManyItem.Create(origin);
        knowledge.Audience = OneOrManyItem.Create(audience);
        knowledge.TimeRange = this.GetTimeRange(
            enclosingMetadata.Timestamps[indexOfMin],
            enclosingMetadata.Timestamps[indexOfMax]
        );
    }

    private List<int> CollectOrdinals<T>(IEnumerable<Scored<T>> candidates)
        where T : MergedKnowledge
    {
        HashSet<int> uniqueOrdinals = [];
        foreach (var candidate in candidates)
        {
            candidate.Item.CollectOrdinals(uniqueOrdinals);
        }
        List<int> ordinals = [.. uniqueOrdinals];
        ordinals.Sort();
        return ordinals;
    }

    private async ValueTask<EnclosingMetadata> GetEnclosingMetadataAsync(
        List<int> rangeOrdinals,
        CancellationToken cancellationToken
    )
    {
        IList<IMessageMetadata> meta = await _conversation.Messages.GetMetadataAsync(
            rangeOrdinals,
            cancellationToken
        ).ConfigureAwait(false);

        IList<string> timestamps = await _conversation.Messages.GetTimestampAsync(
            rangeOrdinals,
            cancellationToken
        ).ConfigureAwait(false);

        return rangeOrdinals.Count != meta.Count || rangeOrdinals.Count != timestamps.Count
            ? throw new InvalidOperationException("ordinal list to meta list mismatch")
            : new EnclosingMetadata
            {
                Ordinals = rangeOrdinals,
                Meta = meta,
                Timestamps = timestamps
            };
    }

    private TimestampRange? GetTimeRange(string? min, string? max)
    {
        return !string.IsNullOrEmpty(min)
            ? new TimestampRange { StartTimestamp = min, EndTimestamp = max }
            : null;
    }

    private struct EnclosingMetadata
    {
        public List<int> Ordinals { get; set; }

        public IList<IMessageMetadata> Meta { get; set; }

        public IList<string> Timestamps { get; set; }
    }

}
