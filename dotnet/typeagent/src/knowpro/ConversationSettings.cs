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

        EmbeddingModel = embeddingModel;

        QueryCompilerSettings = new QueryCompilerSettings();

        // Warning: The 0.85 threshold is good for Ada002 only.
        // The threshold reduces match noise significantly
        // Need a lookup table to recommend settings for different standard models
        RelatedTermIndexSettings = new TermToRelatedTermIndexSettings(
            new TextEmbeddingIndexSettings(embeddingModel, 0.85, 50)
            {
                BatchSize = 64
            }
        );

        MessageTextIndexSettings = new MessageTextIndexSettings(
            new TextEmbeddingIndexSettings(embeddingModel, 0.7)
        );
    }

    public ITextEmbeddingModel EmbeddingModel { get; }

    public QueryCompilerSettings QueryCompilerSettings { get; private set; }

    public TermToRelatedTermIndexSettings RelatedTermIndexSettings { get; private set; }

    public MessageTextIndexSettings MessageTextIndexSettings { get; private set; }
}
