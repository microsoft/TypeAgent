// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public static class ConversationIndexer
{
    public static ValueTask AddToRelatedTermsIndexAsync(
        this IConversation conversation,
        IList<string> terms
    )
    {
        return conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.AddTermsAsync(terms);
    }
}
