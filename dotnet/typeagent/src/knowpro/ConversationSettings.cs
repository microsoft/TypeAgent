// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Lang;
using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public class ConversationSettings
{
    ISearchQueryTranslator _queryTranslator;

    /// <summary>
    /// By default, uses configured OpenAI language and embedding models
    /// You can pass in alternatives using the other constructor
    /// </summary>
    public ConversationSettings()
        : this(new OpenAIChatModel(), new OpenAITextEmbeddingModel())
    {
    }

    public ConversationSettings(
        IChatModel languageModel,
        ITextEmbeddingModel embeddingModel
    )
    {
        ArgumentVerify.ThrowIfNull(languageModel, nameof(languageModel));
        ArgumentVerify.ThrowIfNull(embeddingModel, nameof(embeddingModel));

        EmbeddingModel = embeddingModel;
        LanguageModel = languageModel;

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

        SemanticRefIndexSettings = new SemanticRefIndexSettings(
            new KnowledgeExtractor.KnowledgeExtractor(languageModel)
        );

        QueryCompilerSettings = new QueryCompilerSettings();

        QueryTranslator = new SearchQueryTranslator(languageModel);
    }

    public IChatModel LanguageModel { get; }

    public ITextEmbeddingModel EmbeddingModel { get; }

    public SemanticRefIndexSettings SemanticRefIndexSettings { get; private set; }

    public TermToRelatedTermIndexSettings RelatedTermIndexSettings { get; private set; }

    public MessageTextIndexSettings MessageTextIndexSettings { get; private set; }

    public QueryCompilerSettings QueryCompilerSettings { get; private set; }

    public ISearchQueryTranslator QueryTranslator
    {
        get => _queryTranslator;
        set
        {
            ArgumentVerify.ThrowIfNull(value, nameof(QueryTranslator));
            _queryTranslator = value;
        }
    }

}
