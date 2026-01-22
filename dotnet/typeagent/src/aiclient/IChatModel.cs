// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public interface IChatModel : ILanguageModel
{
    Task<string> CompleteTextAsync(Prompt prompt, TranslationSettings? settings, CancellationToken cancelToken);

    TokenCounter TokenCounter { get; }
}
