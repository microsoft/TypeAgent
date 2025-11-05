// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public class KnowledgeExtractor : IKnowledgeExtractor
{
    JsonTranslator<ExtractedKnowledge> _translator;

    public KnowledgeExtractor(IChatModel chatModel)
    {
        ArgumentVerify.ThrowIfNull(chatModel, nameof(chatModel));
        _translator = CreateTranslator(chatModel);
        Settings = new KnowledgeExtractorSettings();
    }

    public KnowledgeExtractorSettings Settings { get; }

    public JsonTranslator<ExtractedKnowledge> Translator
    {
        get => _translator;
        set
        {
            ArgumentVerify.ThrowIfNull(value, nameof(Translator));
            _translator = value;
        }
    }

    public async Task<KnowledgeResponse> ExtractAsync(
        string message,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(message, nameof(message));

        var knowledgeResponse = await GetKnowledgeResponseWithRetryAsync(message, cancellationToken);

        return knowledgeResponse;
    }

    public async Task<IList<KnowledgeResponse>> ExtractAsync(
        IList<string> messages,
        CancellationToken cancellationToken
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(messages, nameof(messages));

        return (IList<KnowledgeResponse>) await messages.MapAsync(
            Settings.Concurrency,
            GetKnowledgeResponseWithRetryAsync,
            null,
            cancellationToken
        );
    }

    private static JsonTranslator<ExtractedKnowledge> CreateTranslator(IChatModel model)
    {
        var translator = JsonTranslatorFactory.CreateTranslator<ExtractedKnowledge>(
            model,
            "TypeAgent.KnowPro.KnowledgeExtractor.KnowledgeSchema.ts"
        );
        translator.Prompts = new KnowledgeExtractorPrompts();
        return translator;
    }

    private Task<KnowledgeResponse> GetKnowledgeResponseWithRetryAsync(string message, CancellationToken cancellationToken)
    {
        return Async.CallWithRetryAsync(
            (ct) => GetResponseAsync(message, ct),
            Settings.Retry,
            null,
            cancellationToken
        );
    }

    private async Task<KnowledgeResponse> GetResponseAsync(
        string message,
        CancellationToken cancellationToken
    )
    {
        ExtractedKnowledge extractedKnowledge = await _translator.TranslateAsync(
            message,
            cancellationToken
        ).ConfigureAwait(false);

        KnowledgeResponse knowledgeResponse = extractedKnowledge.ToKnowledgeResponse();
        if (Settings.MergeEntityFacets)
        {
            knowledgeResponse.MergeActionKnowledge();
        }

        return knowledgeResponse;
    }
}

public class KnowledgeExtractorPrompts : JsonTranslatorPrompts
{
    public KnowledgeExtractorPrompts()
        : base()
    {
    }

    public override Prompt CreateRequestPrompt(TypeSchema typeSchema, Prompt request, IList<IPromptSection> context = null)
    {
        return
$"You are a service that translates user messages in a conversation into JSON objects of type \"{typeSchema.TypeFullName}\" according to the following TypeScript definitions:\n" +
$"```\n{typeSchema.Schema}\n```\n" +
"The following are messages in a conversation:\n" +
$"\"\"\"\n{request}\n\"\"\"\n" +
"The following is the user request translated into a JSON object with zero spaces of indentation and no properties with the value undefined:\n";
    }
}
