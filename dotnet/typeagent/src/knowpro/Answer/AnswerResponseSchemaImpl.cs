// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

public partial class AnswerResponse
{
    public static AnswerResponse NoAnswer()
        => new AnswerResponse { Type = AnswerType.NoAnswer, WhyNoAnswer = "No search results" };
}
