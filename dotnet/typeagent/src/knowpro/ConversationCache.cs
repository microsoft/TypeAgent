// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class ConversationCache : IConversationCache
{
    public ConversationCache(IConversation conversation)
    {
        SemanticRefs = new CachingCollectionReader<SemanticRef>(conversation.SemanticRefs);
        Messages = new CachingCollectionReader<IMessage>(conversation.Messages);
    }

    public IAsyncCollectionReader<SemanticRef> SemanticRefs { get; }
    public IAsyncCollectionReader<IMessage> Messages { get; }
}
