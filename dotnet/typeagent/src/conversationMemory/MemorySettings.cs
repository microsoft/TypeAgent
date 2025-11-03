// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.KnowledgeExtractor;

namespace TypeAgent.ConversationMemory;

public class MemorySettings
{
    public MemorySettings()
        : this(new ConversationSettings())
    {
    }

    public MemorySettings(
        ConversationSettings conversationSettings,
        int embeddingCacheSize = 64,
        IChatModel? chatModel = null,
        ITextEmbeddingModel? embeddingModel = null
    )
    {
        ArgumentVerify.ThrowIfNull(conversationSettings, nameof(conversationSettings));

        ConversationSettings = conversationSettings;
        ChatModel = chatModel ?? new OpenAIChatModel();
        EmbeddingModel = new TextEmbeddingModelWithCache(embeddingCacheSize);
        QueryTranslator = new SearchQueryTranslator(ChatModel);
        KnowledgeExtractor = new KnowledgeExtractor(ChatModel);
    }

    public IChatModel ChatModel { get; }

    public TextEmbeddingModelWithCache EmbeddingModel { get; }

    public ConversationSettings ConversationSettings { get; }

    public ISearchQueryTranslator? QueryTranslator { get; set; }

    public IKnowledgeExtractor KnowledgeExtractor { get; set; }
}
