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

    public async ValueTask<IList<RelevantEntity>> GetRelevantKnowledgeAsync(
        SemanticRefSearchResult searchResult,
        KnowledgeType kType,
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
            kType,
            cancellationToken
        ).ConfigureAwait(false);

        var mergedEntities = MergedEntity.MergeScored(semanticRefs, true);

        List<Scored<MergedEntity>> candidateEntities = (topK is not null && topK.Value < mergedEntities.Count)
            ? mergedEntities.Values.GetTopK(topK.Value)
            : [.. mergedEntities.Values];

        List<int> rangeOrdinals = MergedEntity.CollectOrdinals(candidateEntities);
        var (meta, timestamps) = await GetEnclosingMetadataAsync(
            rangeOrdinals,
            cancellationToken
        ).ConfigureAwait(false);

        List<RelevantEntity> relevantEntities = [];
        for (int i = 0; i < candidateEntities.Count; ++i)
        {
            RelevantEntity relevantEntity = new RelevantEntity();
            int offset = i * 2;
            var (origin, audience) = _metaMerger.Collect(meta[offset], meta[offset + 1]);
            relevantEntity.Origin = OneOrManyItem.Create(origin);
            relevantEntity.Audience = OneOrManyItem.Create(audience);
            relevantEntity.TimeRange = this.GetTimeRange(timestamps[offset], timestamps[offset + 1]);
        }
        return relevantEntities;
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
