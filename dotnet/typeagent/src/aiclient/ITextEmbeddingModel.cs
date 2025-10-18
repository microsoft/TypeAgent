// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

internal interface ITextEmbeddingModel
{
    Task<float[]> GenerateAsync(string input);
    Task<IList<float[]>> GenerateAsync(IList<string> inputs);
}
