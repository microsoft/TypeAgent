// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace TypeAgent.KnowPro;

public class SemanticRef
{
    [JsonPropertyName("semanticRefOrdinal")]
    public int SemanticRefOrdinal { get; set; } = -1;

    [JsonPropertyName("range")]
    public TextRange Range { get; set; }

    [JsonPropertyName("knowledgeType")]
    public string KnowledgeType { get; set; }

    // The public, strongly-typed property
    [JsonIgnore]
    public KnowledgeSchema Knowledge { get; set; }

    // Internal storage for the raw JSON
    [JsonPropertyName("knowledge")]
    [JsonInclude]
    internal JsonElement? KnowledgeElement
    {
        get => Knowledge is not null ?
               SerializeToElement(Knowledge, KnowledgeType) :
               default;
        set
        {
            if (value is not null)
            {
                Knowledge = Deserialize((JsonElement)value, KnowledgeType);
            }
        }
    }

    public static JsonElement SerializeToElement(KnowledgeSchema knowledge, string type)
    {
        return type switch
        {
            KnowledgeTypes.Entity => Serializer.ToJsonElement(knowledge as ConcreteEntity),
            KnowledgeTypes.Action => Serializer.ToJsonElement(knowledge as Action),
            KnowledgeTypes.Topic => Serializer.ToJsonElement(knowledge as Topic),
            KnowledgeTypes.Tag => Serializer.ToJsonElement(knowledge as Tag),
            _ => throw new JsonException($"Unknown KnowledgeType: {type}")
        };

    }

    public static KnowledgeSchema Deserialize(string json, string type)
    {
        return type switch
        {
            KnowledgeTypes.Entity => Serializer.FromJson<ConcreteEntity>(json),
            KnowledgeTypes.Action => Serializer.FromJson<Action>(json),
            KnowledgeTypes.Topic => Serializer.FromJson<Topic>(json),
            KnowledgeTypes.Tag => Serializer.FromJson<Tag>(json),
            _ => throw new JsonException($"Unknown KnowledgeType: {type}")
        };
    }

    public static KnowledgeSchema Deserialize(JsonElement element, string type)
    {
        return type switch
        {
            KnowledgeTypes.Entity => Serializer.FromJsonElement<ConcreteEntity>(element),
            KnowledgeTypes.Action => Serializer.FromJsonElement<Action>(element),
            KnowledgeTypes.Topic => Serializer.FromJsonElement<Topic>(element),
            KnowledgeTypes.Tag => Serializer.FromJsonElement<Tag>(element),
            _ => throw new JsonException($"Unknown KnowledgeType: {type}")
        };
    }

}

public static class KnowledgeTypes
{
    public const string Entity = "entity";
    public const string Action = "action";
    public const string Topic = "topic";
    public const string Tag = "tag";
}

