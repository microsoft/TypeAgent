// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Answer;

public class AnswerGenerator : IAnswerGenerator
{
    public AnswerGenerator(IChatModel model)
        : this(new AnswerGeneratorSettings(model))
    {
    }

    public AnswerGenerator(AnswerGeneratorSettings settings)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        Settings = settings;
        Translator = new AnswerTranslator(settings.GeneratorModel);
    }

    public AnswerGeneratorSettings Settings { get; }
    public IAnswerTranslator Translator { get; }

    public async Task<AnswerResponse> GenerateAsync(
        string question,
        string context,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(question, nameof(question));
        ArgumentVerify.ThrowIfNullOrEmpty(context, nameof(context));

        context = context.Trim(Settings.MaxCharsInBudget);
        if (string.IsNullOrEmpty(context))
        {
            throw new KnowProException(KnowProException.ErrorCode.EmptyContext);
        }

        string[] prompt = [
            CreateQuestionPrompt(question),
            CreateContextPrompt(context)
        ];

        string promptText = string.Join("\n\n");
        return await Translator.TranslateAsync(
            promptText,
            Settings.ModelInstructions,
            cancellationToken
        ).ConfigureAwait(false);
    }

    public Task<AnswerResponse> GenerateAsync(string question, AnswerContext context, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(question, nameof(question));
        ArgumentVerify.ThrowIfNull(context, nameof(context));

        string contextContent = context.ToPromptString();
        if (string.IsNullOrEmpty(contextContent))
        {
            throw new KnowProException(KnowProException.ErrorCode.EmptyContext);
        }

        return GenerateAsync(question, contextContent, cancellationToken);
    }

    public Task<AnswerResponse> CombinePartialAsync(string question, IList<AnswerResponse> responses, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public static string CreateQuestionPrompt(string question)
    {
        string[] prompt = [
            "The following is a user question:",
            "===",
            question,
            "",
            "===",
            "- The included [ANSWER CONTEXT] contains information that MAY be relevant to answering the question.",
            "- Answer the user question PRECISELY using ONLY information EXPLICITLY provided in the topics, entities, actions, messages and time ranges/timestamps found in [ANSWER CONTEXT]",
            "- Return 'NoAnswer' if you are unsure, , if the answer is not explicitly in [ANSWER CONTEXT], or if the topics or {entity names, types and facets} in the question are not found in [ANSWER CONTEXT].",
            "- Use the 'name', 'type' and 'facets' properties of the provided JSON entities to identify those highly relevant to answering the question.",
            "- 'origin' and 'audience' fields contain the names of entities involved in communication about the knowledge",
            "**Important:** Communicating DOES NOT imply associations such as authorship, ownership etc. E.g. origin: [X] telling audience [Y, Z] communicating about a book does not imply authorship.",
            "- When asked for lists, ensure the list contents answer the question and nothing else. E.g. for the question 'List all books': List only the books in [ANSWER CONTEXT].",
            "- Use direct quotes only when needed or asked. Otherwise answer in your own words.",
            "- Your answer is readable and complete, with appropriate formatting: line breaks, numbered lists, bullet points etc.",
        ];
        return string.Join("\n", prompt);
    }

    public string CreateContextPrompt(string context)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(context, nameof(context));

        string content = $"[ANSWER CONTEXT]\n` + `===\n{context}\n ===\n";
        return content;
    }

}
