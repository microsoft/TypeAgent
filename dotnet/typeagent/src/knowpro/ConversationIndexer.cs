// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public readonly struct IndexingStartPoints
{
    public IndexingStartPoints(int messageCount, int semanticRefCount)
    {
        ArgumentVerify.ThrowIfLessThan(messageCount, 0, nameof(messageCount));
        ArgumentVerify.ThrowIfLessThan(semanticRefCount, 0, nameof(semanticRefCount));

        MessageCount = messageCount;
        SemanticRefCount = semanticRefCount;
    }

    public int MessageCount { get; }
    public int SemanticRefCount { get; }
}

public static class ConversationIndexer
{
    public static async ValueTask AddToSecondaryIndexesAsync(
        this IConversation conversation,
        IndexingStartPoints startAt,
        IList<string> relatedTerms)
    {
        await conversation.AddToRelatedTermsIndexAsync(relatedTerms);
    }

    public static async ValueTask BuildRelatedTermsIndexAsync(
        this IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        var allTerms = await conversation.SemanticRefIndex.GetTermsAsync(cancellationToken).ConfigureAwait(false);
        if (allTerms.Count > 0)
        {
            await conversation.AddToRelatedTermsIndexAsync(allTerms);
        }
    }

    public static ValueTask AddToRelatedTermsIndexAsync(
        this IConversation conversation,
        IList<string> terms
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(terms, nameof(terms));
        // These are idempotent
        return conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.AddTermsAsync(terms);
    }
}
