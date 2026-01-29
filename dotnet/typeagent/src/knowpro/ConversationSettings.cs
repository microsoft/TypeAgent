// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using Microsoft.TypeChat;
using TypeAgent.KnowPro.Answer;
using TypeAgent.KnowPro.Lang;
using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public class ConversationSettings
{
    ISearchQueryTranslator _queryTranslator;
    IAnswerGenerator _answerGenerator;
    IChatModel _languageModel;

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
        ITextEmbeddingModel embeddingModel,
        ISearchQueryTranslator? queryTranslator = null,
        IAnswerGenerator? answerGenerator = null
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

        QueryCompilerSettings = new QueryCompilerSettings();

        if (queryTranslator is not null)
        {
            QueryTranslator = queryTranslator;
        }

        if (answerGenerator is not null)
        {
            AnswerGenerator = answerGenerator;
        }
    }

    public IChatModel LanguageModel
    {
        get => _languageModel;
        set
        {
            ArgumentVerify.ThrowIfNull(value, nameof(LanguageModel));

            if (_languageModel == value)
            {
                return;
            }

            _languageModel = value;

            SemanticRefIndexSettings = new SemanticRefIndexSettings(
                new KnowledgeExtractor.KnowledgeExtractor(_languageModel)
            );

            QueryTranslator = new SearchQueryTranslator(_languageModel);
            // TODO: migrate settings from current answer generator
            AnswerGenerator = new AnswerGenerator(_languageModel);
        }
    }

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

    public IAnswerGenerator AnswerGenerator
    {
        get => _answerGenerator;
        set
        {
            ArgumentVerify.ThrowIfNull(value, nameof(AnswerGenerator));
            _answerGenerator = value;
        }
    }
}
