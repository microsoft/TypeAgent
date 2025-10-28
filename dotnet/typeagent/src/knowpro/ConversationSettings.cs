// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class ConversationSettings
{
    public ConversationSettings()
        : this(new OpenAITextEmbeddingModel())
    {
    }

    public ConversationSettings(ITextEmbeddingModel embeddingModel)
    {
        ArgumentVerify.ThrowIfNull(embeddingModel, nameof(embeddingModel));

        RelatedTermIndexSettings = new RelatedTermIndexSettings(
            new TextEmbeddingIndexSettings(embeddingModel, 0.85, 50)
        );
    }

    public RelatedTermIndexSettings RelatedTermIndexSettings { get; }
}
