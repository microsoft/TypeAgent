// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

public interface IAnswerTranslator
{
    ValueTask<AnswerResponse> TranslateAsync(string request, IList<IPromptSection>? preamble = null, CancellationToken cancellationToken = default);
}
