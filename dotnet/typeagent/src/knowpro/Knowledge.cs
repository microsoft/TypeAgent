// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;

namespace TypeAgent.KnowPro;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "$type")]
[JsonDerivedType(typeof(ConcreteEntity), "entity")]
[JsonDerivedType(typeof(Action), "action")]
[JsonDerivedType(typeof(Topic), "topic")]
[JsonDerivedType(typeof(Tag), "tag")]
[JsonDerivedType(typeof(StructuredTag), "structuredTag")]
public abstract class Knowledge
{
    public Knowledge() { }
}

public interface IKnowledgeSource
{
    KnowledgeResponse? GetKnowledge();
}


public class ConcreteEntity : Knowledge
{
    public ConcreteEntity() { }

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

public class Action : Knowledge
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
    public string[] Topics { get; set; }
}

public class Topic : Knowledge
{
    [JsonPropertyName("text")]
    public string Text { get; set; }
}

public class Tag : Knowledge
{
    [JsonPropertyName("text")]
    public string Text { get; set; }
}

public class StructuredTag : ConcreteEntity
{

}
