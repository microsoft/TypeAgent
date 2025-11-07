// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

public class AnswerContextOptions
{
    public int? EntitiesTopK { get; set; } = 50;

    public int? TopicsTopK { get; set; } = 50;

    public int? MessagesTopK { get; set; } = null;

    public bool Chunking { get; set; } = true;
}
