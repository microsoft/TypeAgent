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
    public static async ValueTask BuildIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        // Todo:
        // Add conversation knowledge
        //
        await conversation.BuildSemanticRefIndexAsync(
            cancellationToken
        ).ConfigureAwait(false);

        await conversation.BuildSecondaryIndexesAsync(
            cancellationToken
        ).ConfigureAwait(false);
    }

    public static async ValueTask BuildSemanticRefIndexAsync(
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

        if (semanticRefs.IsNullOrEmpty())
        {
            return;
        }

        HashSet<string> termsAdded = [];
        await conversation.SemanticRefIndex.AddSemanticRefsAsync(
            semanticRefs,
            termsAdded,
            cancellationToken
        ).ConfigureAwait(false);
    }

    public static async ValueTask BuildSecondaryIndexesAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        await conversation.BuildRelatedTermsIndexAsync(
            cancellationToken
        ).ConfigureAwait(false);

        await conversation.BuildMessageIndexAsync(
            cancellationToken
        ).ConfigureAwait(false);
    }

    public static async ValueTask AddToSecondaryIndexesAsync(
        this IConversation conversation,
        CollectionRangeToIndex messageRange,
        IList<string> relatedTerms,
        CancellationToken cancellationToken = default
    )
    {
        await conversation.AddToRelatedTermsIndexAsync(
            relatedTerms,
            cancellationToken
        ).ConfigureAwait(false);

        await conversation.AddToMessageIndexAsync(
            messageRange.OrdinalStartAt,
            cancellationToken
        ).ConfigureAwait(false);
    }

    public static async ValueTask BuildRelatedTermsIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        var allTerms = await conversation.SemanticRefIndex.GetTermsAsync(
            cancellationToken
        ).ConfigureAwait(false);

        if (allTerms.Count > 0)
        {
            await conversation.AddToRelatedTermsIndexAsync(
                allTerms,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    public static ValueTask AddToRelatedTermsIndexAsync(
        this IConversation conversation,
        IList<string> terms,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(terms, nameof(terms));

        // These are idempotent
        return conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.AddTermsAsync(
            terms,
            cancellationToken
        );
    }

    public static ValueTask BuildMessageIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
     )
    {
        return conversation.AddToMessageIndexAsync(0, cancellationToken);
    }

    public static async ValueTask AddToMessageIndexAsync(
        this IConversation conversation,
        int messageOrdinalStartAt,
        CancellationToken cancellationToken = default
    )
    {
        var batchSize = conversation.Settings.MessageTextIndexSettings.BatchSize;
        var messageIndex = conversation.SecondaryIndexes.MessageIndex;

        int messageCount = await conversation.Messages.GetCountAsync(
            cancellationToken
        ).ConfigureAwait(false);

        var messages = await conversation.Messages.GetSliceAsync(
            messageOrdinalStartAt,
            messageCount,
            cancellationToken
        ).ConfigureAwait(false);

        await conversation.SecondaryIndexes.MessageIndex.AddMessagesAsync(
            messages,
            messageOrdinalStartAt,
            cancellationToken
        ).ConfigureAwait(false);
    }

    internal static async ValueTask<CollectionRangeToIndex> GetMessageRangeToIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        int maxOrdinal = await conversation.SecondaryIndexes.MessageIndex.GetMaxOrdinalAsync(
            cancellationToken
        ).ConfigureAwait(false);

        int maxCount = await conversation.Messages.GetCountAsync(
            cancellationToken
        ).ConfigureAwait(false);

        return new CollectionRangeToIndex(
            maxOrdinal + 1,
            maxCount
        );
    }

    internal static async ValueTask<CollectionRangeToIndex> GetSemanticRefRangeToIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        int maxOrdinal = await conversation.SemanticRefIndex.GetMaxOrdinalAsync(
            cancellationToken
        ).ConfigureAwait(false);

        int count = await conversation.SemanticRefs.GetCountAsync(
            cancellationToken
        ).ConfigureAwait(false);

        return new CollectionRangeToIndex(
            maxOrdinal + 1,
            count
        );
    }
}
