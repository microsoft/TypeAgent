// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Answer;

public class AnswerGenerator : IAnswerGenerator
{
    public AnswerGenerator(AnswerGeneratorSettings settings)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));
        Settings = settings;
    }

    public Task<AnswerResponse> GenerateAsync(string question, AnswerContext context, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public AnswerGeneratorSettings Settings { get; }

    public Task<AnswerResponse> CombinePartialAsync(string question, IList<AnswerResponse> responses, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
