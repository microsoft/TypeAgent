// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class ConversationCacheSettings
{
    // Null means cache all
    public int? SemanticRefCacheSize { get; set; } = null;

    // Null means cache all
    public int? MessageCacheSize { get; set; } = null;

    // Null means cache all
    public int? RelatedTermFuzzyCacheSize { get; set; } = null;
}

public class ConversationCache : IConversationCache
{
    public ConversationCache(
        IConversation conversation,
        ConversationCacheSettings? settings = null
    )
    {
        SemanticRefs = new CachingCollectionReader<SemanticRef>(
            conversation.SemanticRefs,
            settings?.SemanticRefCacheSize
        );
        Messages = new CachingCollectionReader<IMessage>(
            conversation.Messages,
            settings?.MessageCacheSize
        );
        RelatedTermsFuzzy = new TermToRelatedTermsFuzzyCache(
            conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex,
            settings?.RelatedTermFuzzyCacheSize
        );
    }

    public IAsyncCollectionReader<SemanticRef> SemanticRefs { get; }

    public IAsyncCollectionReader<IMessage> Messages { get; }

    public ITermToRelatedTermsFuzzyLookup RelatedTermsFuzzy { get; }
}
