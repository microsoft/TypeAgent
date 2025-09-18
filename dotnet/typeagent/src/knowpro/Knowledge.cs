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

public class ConcreteEntity : IKnowledge
{
    public ConcreteEntity()
    {

    }

    public ConcreteEntity(string name, string type)
    {
        this.Name = name;
        this.Type = [type];
    }

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
    public IList<ConcreteEntity> Entities { get; set; }
    [JsonPropertyName("actions")]
    public IList<Action> Actions { get; set; }
    [JsonPropertyName("inverseActions")]
    public IList<Action> InverseActions { get; set; }
    [JsonPropertyName("topics")]
    public IList<string> Topic { get; set; }
}

public class Topic : IKnowledge
{
    public string Text { get; set; }
}

public class Tag : IKnowledge
{
    public string Text { get; set; }
}

public class StructuredTag : ConcreteEntity
{

}
