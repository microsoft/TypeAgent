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

    public MemorySettings(IChatModel languageModel,  ITextEmbeddingModel embeddingModel)
        : this(new ConversationSettings(languageModel, embeddingModel))
    {
    }

    public MemorySettings(
        ConversationSettings conversationSettings,
        int embeddingCacheSize = 64,
        NoiseText? noiseTerms = null
    )
    {
        ArgumentVerify.ThrowIfNull(conversationSettings, nameof(conversationSettings));

        ConversationSettings = conversationSettings;
        NoiseTerms = noiseTerms ?? new NoiseText(
            typeof(MemorySettings).Assembly,
            "TypeAgent.ConversationMemory.noiseTerms.txt"
        );

    }

    public ConversationSettings ConversationSettings { get; }

    public NoiseText? NoiseTerms { get; set; }

    // Setting this to true leverages Structured Tags
    public bool? UseScopedSearch { get; set; } = null;
}
