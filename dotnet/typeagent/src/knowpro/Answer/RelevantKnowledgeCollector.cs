// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

internal class RelevantKnowledgeCollector
{
    IConversation _conversation;
    MetadataMerger _metaMerger;

    public RelevantKnowledgeCollector(IConversation conversation)
    {
        _conversation = conversation;
        _metaMerger = new MetadataMerger();
    }

    public async ValueTask<IList<RelevantEntity>> GetRelevantEntitiesAsync(
        SemanticRefSearchResult searchResult,
        int? topK = null,
        CancellationToken cancellationToken = default
    )
    {
        if (!searchResult.HasMatches)
        {
            return [];
        }

        IList<Scored<SemanticRef>> semanticRefs = await _conversation.GetSemanticRefReader().GetScoredAsync(
            searchResult.SemanticRefMatches,
            KnowledgeType.Entity,
            cancellationToken
        ).ConfigureAwait(false);

        var mergedEntities = MergedEntity.Merge(semanticRefs, true);

        List<Scored<MergedEntity>> candidateEntities = (topK is not null && topK.Value < mergedEntities.Count)
            ? mergedEntities.Values.GetTopK(topK.Value)
            : [.. mergedEntities.Values];

        var (meta, timestamps) = await GetEnclosingMetadataAsync(
            CollectOrdinals(candidateEntities),
            cancellationToken
        ).ConfigureAwait(false);

        List<RelevantEntity> relevantEntities = [];
        for (int i = 0; i < candidateEntities.Count; ++i)
        {
            var relevantEntity = new RelevantEntity();
            int offset = i * 2;
            var (origin, audience) = _metaMerger.Collect(meta[offset], meta[offset + 1]);
            relevantEntity.Origin = OneOrManyItem.Create(origin);
            relevantEntity.Audience = OneOrManyItem.Create(audience);
            relevantEntity.TimeRange = this.GetTimeRange(timestamps[offset], timestamps[offset + 1]);
        }
        return relevantEntities;
    }

    public async ValueTask<IList<RelevantTopic>> GetRelevantTopicsAsync(
        SemanticRefSearchResult searchResult,
        int? topK = null,
        CancellationToken cancellationToken = default
    )
    {
        if (!searchResult.HasMatches)
        {
            return [];
        }

        IList<Scored<SemanticRef>> semanticRefs = await _conversation.GetSemanticRefReader().GetScoredAsync(
            searchResult.SemanticRefMatches,
            KnowledgeType.Entity,
            cancellationToken
        ).ConfigureAwait(false);

        var mergedTopics
            = MergedTopic.Merge(semanticRefs, true);

        List<Scored<MergedTopic>> candidateTopics = (topK is not null && topK.Value < mergedTopics.Count)
            ? mergedTopics.Values.GetTopK(topK.Value)
            : [.. mergedTopics.Values];

        var (meta, timestamps) = await GetEnclosingMetadataAsync(
            CollectOrdinals(candidateTopics),
            cancellationToken
        ).ConfigureAwait(false);

        List<RelevantTopic> relevantTopics = [];
        for (int i = 0; i < candidateTopics.Count; ++i)
        {
            var relevantTopic = new RelevantTopic();
            int offset = i * 2;
            var (origin, audience) = _metaMerger.Collect(meta[offset], meta[offset + 1]);
            relevantTopic.Origin = OneOrManyItem.Create(origin);
            relevantTopic.Audience = OneOrManyItem.Create(audience);
            relevantTopic.TimeRange = this.GetTimeRange(timestamps[offset], timestamps[offset + 1]);
        }
        return relevantTopics;
    }

    private List<int> CollectOrdinals(IEnumerable<Scored<MergedEntity>> candidates)
    {
        List<int> rangeOrdinals = [];
        foreach (var candidate in candidates)
        {
            candidate.Item.CollectOrdinals(rangeOrdinals);
        }
        return rangeOrdinals;
    }

    private List<int> CollectOrdinals(IEnumerable<Scored<MergedTopic>> candidates)
    {
        List<int> rangeOrdinals = [];
        foreach (var candidate in candidates)
        {
            candidate.Item.CollectOrdinals(rangeOrdinals);
        }
        return rangeOrdinals;
    }

    private async ValueTask<(IList<IMessageMetadata>, IList<string>)> GetEnclosingMetadataAsync(
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

        return (meta, timestamps);
    }

    private TimestampRange? GetTimeRange(string? min, string? max)
    {
        return !string.IsNullOrEmpty(min)
            ? new TimestampRange { StartTimestamp = min, EndTimestamp = max }
            : null;
    }
}
