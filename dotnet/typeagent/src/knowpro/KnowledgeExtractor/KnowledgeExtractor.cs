// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.



namespace TypeAgent.KnowPro.KnowledgeExtractor;

public class KnowledgeExtractor : IKnowledgeExtractor
{
    JsonTranslator<KnowledgeResponse> _translator;

    public KnowledgeExtractor(IChatModel chatModel)
    {
        ArgumentVerify.ThrowIfNull(chatModel, nameof(chatModel));
        _translator = CreateTranslator(chatModel);
    }

    public KnowledgeExtractorSettings Settings { get; }

    public JsonTranslator<KnowledgeResponse> Translator
    {
        get => _translator;
        set
        {
            ArgumentVerify.ThrowIfNull(value, nameof(Translator));
            _translator = value;
        }
    }

    public async ValueTask<TypeAgent.KnowPro.KnowledgeResponse?> ExtractAsync(
        string message,
        CancellationToken cancellationToken = default
    )
    {
        KnowledgeResponse response = await _translator.TranslateAsync(
            message,
            cancellationToken
        ).ConfigureAwait(false);

        return null;
    }

    private static JsonTranslator<KnowledgeResponse> CreateTranslator(ILanguageModel model)
    {
        JsonTranslator<KnowledgeResponse> translator = new JsonTranslator<KnowledgeResponse>(
            model,
            SchemaLoader.LoadResource(
                typeof(KnowledgeExtractor).Assembly,
                "TypeAgent.KnowPro.KnowledgeExtractor.KnowledgeSchema.ts"
            )
        );
        translator.Prompts = new KnowledgeExtractorPrompts();
        return translator;
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
