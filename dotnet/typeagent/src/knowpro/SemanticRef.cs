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
            KnowPro.KnowledgeType.Entity => Serializer.ToJsonElement(knowledge as ConcreteEntity),
            KnowPro.KnowledgeType.Action => Serializer.ToJsonElement(knowledge as Action),
            KnowPro.KnowledgeType.Topic => Serializer.ToJsonElement(knowledge as Topic),
            KnowPro.KnowledgeType.Tag => Serializer.ToJsonElement(knowledge as Tag),
            _ => throw new JsonException($"Unknown KnowledgeType: {type}")
        };

    }

    public static KnowledgeSchema Deserialize(string json, string type)
    {
        return type switch
        {
            KnowPro.KnowledgeType.Entity => Serializer.FromJson<ConcreteEntity>(json),
            KnowPro.KnowledgeType.Action => Serializer.FromJson<Action>(json),
            KnowPro.KnowledgeType.Topic => Serializer.FromJson<Topic>(json),
            KnowPro.KnowledgeType.Tag => Serializer.FromJson<Tag>(json),
            _ => throw new JsonException($"Unknown KnowledgeType: {type}")
        };
    }

    public static KnowledgeSchema Deserialize(JsonElement element, string type)
    {
        return type switch
        {
            KnowPro.KnowledgeType.Entity => Serializer.FromJsonElement<ConcreteEntity>(element),
            KnowPro.KnowledgeType.Action => Serializer.FromJsonElement<Action>(element),
            KnowPro.KnowledgeType.Topic => Serializer.FromJsonElement<Topic>(element),
            KnowPro.KnowledgeType.Tag => Serializer.FromJsonElement<Tag>(element),
            _ => throw new JsonException($"Unknown KnowledgeType: {type}")
        };
    }

}

/// <summary>
/// TODO: Make this strongly typed to be a discriminated union like Typescript
/// </summary>
public static class KnowledgeType
{
    /// <summary>
    /// <see cref="ConcreteEntity"/>
    /// </summary>
    public const string Entity = "entity";
    /// <summary>
    /// <see cref="KnowPro.Action"/>
    /// </summary>
    public const string Action = "action";
    /// <summary>
    /// <see cref="KnowPro.Topic"/>
    /// </summary>
    public const string Topic = "topic";
    /// <summary>
    /// <see cref="KnowPro.Tag"/>
    /// </summary>
    public const string Tag = "tag";
    /// <summary>
    /// <see cref="KnowPro.StructuredTag"/>
    /// </summary>
    public const string STag = "sTag";
}

