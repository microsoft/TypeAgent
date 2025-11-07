// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

public class AnswerTranslator : IAnswerTranslator
{
    JsonTranslator<AnswerResponse> _translator;

    public AnswerTranslator(IChatModel model)
    {
        ArgumentVerify.ThrowIfNull(model, nameof(model));

        _translator = JsonTranslatorFactory.CreateTranslator<AnswerResponse>(
            model,
            "TypeAgent.KnowPro.Answer.answerResponseSchema.ts"
        );
    }

    public async ValueTask<AnswerResponse> TranslateAsync(string request, IList<IPromptSection>? preamble = null, CancellationToken cancellationToken = default)
    {
        return await _translator.TranslateAsync(
            request,
            preamble,
            null,
            cancellationToken
        ).ConfigureAwait(false);
    }
}
