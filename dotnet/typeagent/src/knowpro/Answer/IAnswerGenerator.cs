// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

public interface IAnswerGenerator
{
    AnswerGeneratorSettings Settings { get; }

    Task<AnswerResponse> GenerateAsync(
        string question,
        AnswerContext context,
        CancellationToken cancellationToken = default
    );

    Task<AnswerResponse> CombinePartialAsync(
        string question,
        IList<AnswerResponse> responses,
        CancellationToken cancellationToken = default
    );
}
