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
    public Knowledge Knowledge { get; set; }

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

    public static JsonElement SerializeToElement(Knowledge knowledge, string type)
    {
        return type switch
        {
            KnowPro.KnowledgeType.Entity => Serializer.ToJsonElement(knowledge as ConcreteEntity),
            KnowPro.KnowledgeType.Action => Serializer.ToJsonElement(knowledge as Action),
            KnowPro.KnowledgeType.Topic => Serializer.ToJsonElement(knowledge as Topic),
            KnowPro.KnowledgeType.Tag => Serializer.ToJsonElement(knowledge as Tag),
            _ => throw new KnowProException(
                KnowProException.ErrorCode.InvalidKnowledgeType,
                ToError(type)
            )
        };

    }

    public static Knowledge Deserialize(string json, string type)
    {
        return type switch
        {
            KnowPro.KnowledgeType.Entity => Serializer.FromJsonRequired<ConcreteEntity>(json),
            KnowPro.KnowledgeType.Action => Serializer.FromJsonRequired<Action>(json),
            KnowPro.KnowledgeType.Topic => Serializer.FromJsonRequired<Topic>(json),
            KnowPro.KnowledgeType.Tag => Serializer.FromJsonRequired<Tag>(json),
            _ => throw new KnowProException(
                KnowProException.ErrorCode.InvalidKnowledgeType,
                ToError(type)
            )
        };
    }

    public static Knowledge Deserialize(JsonElement element, string type)
    {
        return type switch
        {
            KnowPro.KnowledgeType.Entity => Serializer.FromJsonElementRequired<ConcreteEntity>(element),
            KnowPro.KnowledgeType.Action => Serializer.FromJsonElementRequired<Action>(element),
            KnowPro.KnowledgeType.Topic => Serializer.FromJsonElementRequired<Topic>(element),
            KnowPro.KnowledgeType.Tag => Serializer.FromJsonElementRequired<Tag>(element),
            _ => throw new KnowProException(
                KnowProException.ErrorCode.InvalidKnowledgeType,
                ToError(type)
            )
        };
    }

    static string ToError(string type)
    {
        return $"Unknown KnowledgeType: {type}";
    }
}

