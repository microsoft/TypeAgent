// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class ConversationSettings
{
    public ConversationSettings(ITextEmbeddingModel embeddingModel)
    {
        RelatedTermIndexSettings = new RelatedTermIndexSettings(
            new TextEmbeddingIndexSettings(embeddingModel, 0.85, 50)
        );
    }

    public RelatedTermIndexSettings RelatedTermIndexSettings { get; }
}
