// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

public static class ConversationExtensions
{
    public static async ValueTask<IList<RelevantEntity>> GetRelevantKnowledgeAsync(
        this IConversation conversation,
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

        IList<Scored<SemanticRef>> semanticRefs = await conversation.GetSemanticRefReader().GetScoredAsync(
            searchResult.SemanticRefMatches,
            kType,
            cancellationToken
        ).ConfigureAwait(false);

        var mergedEntities = MergedEntity.MergeScored(semanticRefs, true);

        IList<Scored<MergedEntity>> candidateEntities = (topK is not null && topK.Value < mergedEntities.Count)
            ? mergedEntities.Values.GetTopK(topK.Value)
            : [.. mergedEntities.Values];

        List<int> rangeOrdinals = MergedEntity.CollectOrdinals(candidateEntities);
        IList<IMessageMetadata> meta = await conversation.Messages.GetMetadataAsync(
            rangeOrdinals,
            cancellationToken
        ).ConfigureAwait(false);
        IList<string> timestamps = await conversation.Messages.GetTimestampAsync(
            rangeOrdinals,
            cancellationToken
        ).ConfigureAwait(false);

        List<RelevantEntity> relevantEntities = [];
        return relevantEntities;
    }
}
