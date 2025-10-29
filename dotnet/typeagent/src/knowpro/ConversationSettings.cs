// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

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

        // Warning: The 0.85 threshold is good for Ada002 only.
        // The threshold reduces match noise significantly
        // Need a lookup table to recommend settings for different standard models
        RelatedTermIndexSettings = new RelatedTermIndexSettings(
            new TextEmbeddingIndexSettings(embeddingModel, 0.85, 50)
        );

        QueryCompilerSettings = new QueryCompilerSettings();
    }

    public QueryCompilerSettings QueryCompilerSettings { get; }

    public RelatedTermIndexSettings RelatedTermIndexSettings { get; }
}
