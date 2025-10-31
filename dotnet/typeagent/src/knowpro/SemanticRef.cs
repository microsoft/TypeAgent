// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace TypeAgent.KnowPro;

public class SemanticRef
{
    public SemanticRef()
    {

    }

    public SemanticRef(
        Knowledge knowledge,
        TextRange range
    )
    {
        ArgumentVerify.ThrowIfNull(knowledge, nameof(knowledge));
        Knowledge = knowledge;
        KnowledgeType = knowledge.KnowledgeType;
        Range = range;
    }

    [JsonPropertyName("semanticRefOrdinal")]
    public int SemanticRefOrdinal { get; set; } = -1;

    [JsonPropertyName("range")]
    public TextRange Range { get; set; }

    [JsonIgnore]
    public KnowledgeType KnowledgeType { get; set; }

    // The public, strongly-typed property
    [JsonIgnore]
    public Knowledge Knowledge { get; set; }

    // For serialization
    [JsonPropertyName("knowledgeType")]
    [JsonInclude]
    private string KType
    {
        get => KnowledgeType;
        set => KnowledgeType = value;
    }

    [JsonPropertyName("knowledge")]
    [JsonInclude]
    private JsonElement? KnowledgeElement
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

    [JsonIgnore]
    public bool IsEntity => KnowledgeType == KnowledgeType.Entity;

    public ConcreteEntity? AsEntity()
    {
        return IsEntity ? Knowledge as ConcreteEntity : null;
    }

    public static JsonElement SerializeToElement(Knowledge knowledge, string type)
    {
        return type switch
        {
            KnowPro.KnowledgeType.EntityTypeName => Serializer.ToJsonElement(knowledge as ConcreteEntity),
            KnowPro.KnowledgeType.ActionTypeName => Serializer.ToJsonElement(knowledge as Action),
            KnowPro.KnowledgeType.TopicTypeName => Serializer.ToJsonElement(knowledge as Topic),
            KnowPro.KnowledgeType.STagTypeName => Serializer.ToJsonElement(knowledge as StructuredTag),
            KnowPro.KnowledgeType.TagTypeName => Serializer.ToJsonElement(knowledge as Tag),
            _ => throw new KnowProException(
                KnowProException.ErrorCode.InvalidKnowledgeType,
                type
            )
        };

    }

    public static Knowledge Deserialize(string json, string type)
    {
        return type switch
        {
            KnowPro.KnowledgeType.EntityTypeName => Serializer.FromJsonRequired<ConcreteEntity>(json),
            KnowPro.KnowledgeType.ActionTypeName => Serializer.FromJsonRequired<Action>(json),
            KnowPro.KnowledgeType.TopicTypeName => Serializer.FromJsonRequired<Topic>(json),
            KnowPro.KnowledgeType.STagTypeName => Serializer.FromJsonRequired<StructuredTag>(json),
            KnowPro.KnowledgeType.TagTypeName => Serializer.FromJsonRequired<Tag>(json),
            _ => throw new KnowProException(
                KnowProException.ErrorCode.InvalidKnowledgeType,
                type
            )
        };
    }

    public static Knowledge Deserialize(JsonElement element, string type)
    {
        return type switch
        {
            KnowPro.KnowledgeType.EntityTypeName => Serializer.FromJsonElementRequired<ConcreteEntity>(element),
            KnowPro.KnowledgeType.ActionTypeName => Serializer.FromJsonElementRequired<Action>(element),
            KnowPro.KnowledgeType.TopicTypeName => Serializer.FromJsonElementRequired<Topic>(element),
            KnowPro.KnowledgeType.STagTypeName => Serializer.FromJsonElementRequired<StructuredTag>(element),
            KnowPro.KnowledgeType.TagTypeName => Serializer.FromJsonElementRequired<Tag>(element),
            _ => throw new KnowProException(
                KnowProException.ErrorCode.InvalidKnowledgeType,
                type
            )
        };
    }
}
