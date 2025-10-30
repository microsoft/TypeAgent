// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public readonly struct IndexingStartPoints
{
    public IndexingStartPoints(int messageOrdinal, int semanticRefOrdinal)
    {
        ArgumentVerify.ThrowIfLessThan(messageOrdinal, 0, nameof(messageOrdinal));
        ArgumentVerify.ThrowIfLessThan(semanticRefOrdinal, 0, nameof(semanticRefOrdinal));

        MessageOrdinalStartAt = messageOrdinal;
        SemanticRefOrdinalStartAt = semanticRefOrdinal;
    }

    public int MessageOrdinalStartAt { get; }
    public int SemanticRefOrdinalStartAt { get; }
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

    public static ValueTask BuildSemanticRefIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
        )
    {
        return ValueTask.CompletedTask;
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
        IndexingStartPoints startAt,
        IList<string> relatedTerms,
        CancellationToken cancellationToken = default
    )
    {
        await conversation.AddToRelatedTermsIndexAsync(
            relatedTerms,
            cancellationToken
        ).ConfigureAwait(false);

        await conversation.AddToMessageIndexAsync(
            startAt.MessageOrdinalStartAt,
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
}
