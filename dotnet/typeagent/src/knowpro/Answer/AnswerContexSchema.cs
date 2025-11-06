// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

public partial class RelevantKnowledge
{
    // Entity or entities who mentioned the knowledge
    [JsonPropertyName("origin")]
    public OneOrManyItem<string>? Origin { get; set; }

    // Entity or entities who received or consumed this knowledge
    [JsonPropertyName("audience")]
    public OneOrManyItem<string>? Audience { get; set; }

    // Time period during which this knowledge was gathered
    [JsonPropertyName("timeRange")]
    public TimestampRange? TimeRange { get; set; }
};

public partial class RelevantTopic : RelevantKnowledge
{
    [JsonPropertyName("knowledge")]
    public string? Topic { get; set; }
}

public partial class RelevantEntity : RelevantKnowledge
{
    [JsonPropertyName("knowledge")]
    public ConcreteEntity? Entity { get; set; }
}

public partial class RelevantMessage
{
    [JsonPropertyName("from")]
    public OneOrManyItem<string>? From { get; set; }

    [JsonPropertyName("to")]
    public OneOrManyItem<string>? To { get; set; }

    [JsonPropertyName("timestamp")]
    public string? Timestamp { get; set; }

    [JsonPropertyName("messageText")]
    public OneOrManyItem<string>? MessageText { get; set; }
}

public partial class AnswerContext
{
    // Relevant entities
    // Use the 'name' and 'type' properties of entities to PRECISELY identify those that answer the user question.
    public IList<RelevantEntity>? Entities { get; set; }

    // Relevant topics
    public IList<RelevantTopic> Topics { get; set; }

    // Relevant messages
    public IList<RelevantMessage>? Messages { get; set; }
};
