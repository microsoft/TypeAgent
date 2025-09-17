// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IKnowledge
{
}

public interface IKnowledgeSource
{
    KnowledgeResponse? GetKnowledge();
}

public readonly struct KnowledgeType
{
    public static readonly KnowledgeType Entity = new KnowledgeType("entity");
    public static readonly KnowledgeType Action = new KnowledgeType("action");
    public static readonly KnowledgeType Topic = new KnowledgeType("topic");

    private KnowledgeType(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static implicit operator string(KnowledgeType knowledgeType)
    {
        return knowledgeType.Value;
    }
}

public class ConcreteEntity : IKnowledge
{
    [JsonPropertyName("name")]
    public string Name { get; set; }
    [JsonPropertyName("type")]
    public string[] Type { get; set; }
    [JsonPropertyName("facets")]
    public Facet[] Facets { get; set; }
}

public class Action : IKnowledge
{
    [JsonPropertyName("verbs")]
    public string[] Verbs { get; set; }
    [JsonPropertyName("verbTense")]
    public string VerbTense { get; set; }
    [JsonPropertyName("subjectEntityName")]
    public string SubjectEntityName { get; set; }
    [JsonPropertyName("objectEntityName")]
    public string ObjectEntityName { get; set; }
    [JsonPropertyName("indirecObjectEntityName")]
    public string IndirectObjectEntityName { get; set; }
}

public class KnowledgeResponse
{
    [JsonPropertyName("entities")]
    public ConcreteEntity[] Entities { get; set; }
    [JsonPropertyName("actions")]
    public Action[] Actions { get; set; }
    [JsonPropertyName("inverseActions")]
    public Action[] InverseActions { get; set; }
    [JsonPropertyName("topics")]
    public string[] Topic { get; set; }
}

public class Topic : IKnowledge
{
    public string Text { get; set; }
}

