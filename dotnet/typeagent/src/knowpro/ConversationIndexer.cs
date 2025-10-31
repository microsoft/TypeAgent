// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public readonly struct CollectionRangeToIndex
{
    public CollectionRangeToIndex(int ordinal, int count)
    {
        ArgumentVerify.ThrowIfLessThan(ordinal, 0, nameof(ordinal));
        ArgumentVerify.ThrowIfLessThan(count, 0, nameof(count));

        OrdinalStartAt = ordinal;
        Count = count;
    }

    public int OrdinalStartAt { get; }

    public int Count { get; }

    public bool IsEmpty => OrdinalStartAt >= Count;

}

public class CollectionRangesToIndex
{
    public CollectionRangesToIndex(
        CollectionRangeToIndex messages,
        CollectionRangeToIndex semanicRefs
    )
    {
        Messages = messages;
        SemanticRefs = semanicRefs;
    }

    public CollectionRangeToIndex Messages { get; }

    public CollectionRangeToIndex SemanticRefs { get; }
}

public static class ConversationIndexer
{
    /// <summary>
    /// Incrementally update the index to include any new messages and semantic refs
    /// that have not already been indexed
    /// </summary>
    /// <param name="conversation"></param>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    public static async ValueTask UpdateIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        await conversation.UpdateMessageIndexAsync(
            true,
            cancellationToken
        ).ConfigureAwait(false);

        await conversation.UpdateSemanticRefIndexAsync(
            cancellationToken
        ).ConfigureAwait(false);
    }

    /// <summary>
    /// Incrementally update the message index
    /// </summary>
    /// <returns></returns>
    public static async ValueTask UpdateMessageIndexAsync(
        this IConversation conversation,
        bool addKnowledge,
        CancellationToken cancellationToken = default
    )
    {
        var messageRangeToIndex = await conversation.GetMessageRangeToIndexAsync(
            cancellationToken
        ).ConfigureAwait(false);

        if (messageRangeToIndex.IsEmpty)
        {
            return;
        }

        var messagesToIndex = await conversation.Messages.GetSliceAsync(
            messageRangeToIndex.OrdinalStartAt,
            messageRangeToIndex.Count,
            cancellationToken
        ).ConfigureAwait(false);

        if (addKnowledge)
        {
            await conversation.AddMessageKnowledgeAsync(
                messageRangeToIndex,
                messagesToIndex,
                cancellationToken
            ).ConfigureAwait(false);
        }

        await conversation.SecondaryIndexes.MessageIndex.AddMessagesAsync(
            messagesToIndex,
            messageRangeToIndex.OrdinalStartAt,
            cancellationToken
        ).ConfigureAwait(false);

    }

    /// <summary>
    /// Incrementally update SemanticRef and related indexes
    /// </summary>
    /// <param name="conversation"></param>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    public static async ValueTask UpdateSemanticRefIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        CollectionRangeToIndex indexRange = await conversation.GetSemanticRefRangeToIndexAsync(
            cancellationToken
        ).ConfigureAwait(false);
        if (indexRange.IsEmpty)
        {
            return;
        }

        IList<SemanticRef> semanticRefs = await conversation.SemanticRefs.GetSliceAsync(
            indexRange.OrdinalStartAt,
            indexRange.Count,
            cancellationToken
        ).ConfigureAwait(false);

        HashSet<string> termsAdded = [];
        await conversation.SemanticRefIndex.AddSemanticRefsAsync(
            semanticRefs,
            termsAdded,
            cancellationToken
        ).ConfigureAwait(false);

        await conversation.SecondaryIndexes.PropertyToSemanticRefIndex.AddSemanticRefsAsync(
            semanticRefs,
            cancellationToken
        ).ConfigureAwait(false);

        await conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.AddTermsAsync(
            [.. termsAdded],
            cancellationToken
        ).ConfigureAwait(false);
    }

    public static async ValueTask RebuildRelatedTermsIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        await conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.ClearAsync(
            cancellationToken
        ).ConfigureAwait(false);

        var allTerms = await conversation.SemanticRefIndex.GetTermsAsync(
            cancellationToken
        ).ConfigureAwait(false);

        if (allTerms.Count > 0)
        {
            await conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.AddTermsAsync(
                allTerms,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    internal static async ValueTask AddMessageKnowledgeAsync(
        this IConversation conversation,
        CollectionRangeToIndex messageRange,
        IList<IMessage> messages,
        CancellationToken cancellationToken = default
    )
    {
        List<SemanticRef> semanticRefs = [];

        int count = messages.Count;
        for (int i = 0; i < count; ++i)
        {
            var message = messages[i];
            var knowledge = message.GetKnowledge();
            if (knowledge is not null)
            {
                TextRange textRange = new TextRange(messageRange.OrdinalStartAt + i);
                semanticRefs.AddRange(knowledge.ToSemanticRefs(textRange));
            }
        }

        if (!semanticRefs.IsNullOrEmpty())
        {
            await conversation.SemanticRefs.AppendAsync(
                semanticRefs,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    internal static async ValueTask<CollectionRangeToIndex> GetMessageRangeToIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        int? maxOrdinal = await conversation.SecondaryIndexes.MessageIndex.GetMaxOrdinalAsync(
            cancellationToken
        ).ConfigureAwait(false);

        int maxCount = await conversation.Messages.GetCountAsync(
            cancellationToken
        ).ConfigureAwait(false);

        return new CollectionRangeToIndex(
            maxOrdinal is not null ? maxOrdinal.Value + 1 : 0,
            maxCount
        );
    }

    internal static async ValueTask<CollectionRangeToIndex> GetSemanticRefRangeToIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        int? maxOrdinal = await conversation.SemanticRefIndex.GetMaxOrdinalAsync(
            cancellationToken
        ).ConfigureAwait(false);

        int count = await conversation.SemanticRefs.GetCountAsync(
            cancellationToken
        ).ConfigureAwait(false);

        return new CollectionRangeToIndex(
            maxOrdinal is not null ? maxOrdinal.Value + 1 : 0,
            count
        );
    }
}
