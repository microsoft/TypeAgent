// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace TypeAgent.KnowPro;

public class SemanticRef
{
    static JsonSerializerOptions s_serializerOptions;

    static SemanticRef()
    {
        s_serializerOptions = Json.DefaultOptions();
        s_serializerOptions.Converters.Add(new FacetValueJsonConverter());
    }

    [JsonPropertyName("semanticRefOrdinal")]
    public int SemanticRefOrdinal { get; set; }

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
            if(value is not null)
            {
                Knowledge = Deserialize((JsonElement)value, KnowledgeType);
            }
        }
    }

    public static JsonElement SerializeToElement(Knowledge knowledge, string type)
    {
        return type switch
        {
            KnowledgeTypes.Entity => JsonSerializer.SerializeToElement(knowledge as ConcreteEntity, s_serializerOptions),
            KnowledgeTypes.Action => JsonSerializer.SerializeToElement(knowledge as Action),
            KnowledgeTypes.Topic => JsonSerializer.SerializeToElement(knowledge as Topic),
            KnowledgeTypes.Tag => JsonSerializer.SerializeToElement(knowledge as Tag),
            _ => throw new JsonException($"Unknown KnowledgeType: {type}")
        };

    }

    public static Knowledge Deserialize(string json, string type)
    {
        return type switch
        {
            KnowledgeTypes.Entity => JsonSerializer.Deserialize<ConcreteEntity>(json, s_serializerOptions),
            KnowledgeTypes.Action => JsonSerializer.Deserialize<Action>(json),
            KnowledgeTypes.Topic => JsonSerializer.Deserialize<Topic>(json),
            KnowledgeTypes.Tag => JsonSerializer.Deserialize<Tag>(json),
            _ => throw new JsonException($"Unknown KnowledgeType: {type}")
        };
    }

    public static Knowledge Deserialize(JsonElement element, string type)
    {
        return type switch
        {
            KnowledgeTypes.Entity => element.Deserialize<ConcreteEntity>(s_serializerOptions),
            KnowledgeTypes.Action => element.Deserialize<Action>(),
            KnowledgeTypes.Topic => element.Deserialize<Topic>(),
            KnowledgeTypes.Tag => element.Deserialize<Tag>(),
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

