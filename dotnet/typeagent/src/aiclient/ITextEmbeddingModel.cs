// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

internal interface ITextEmbeddingModel
{
    Task<float[]> GenerateAsync(string input, CancellationToken cancellationToken);

    Task<IList<float[]>> GenerateAsync(string[] inputs, CancellationToken cancellationToken);
}
