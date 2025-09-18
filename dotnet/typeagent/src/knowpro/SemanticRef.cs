// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace TypeAgent.KnowPro;

public class SemanticRef
{
    [JsonPropertyName("semanticRefOrdinal")]
    public int SemanticRefOrdinal { get; set; }

    [JsonPropertyName("range")]
    public TextRange Range { get; set; }

    [JsonPropertyName("knowledgeType")]
    public string KnowledgeType { get; set; }

    // The public, strongly-typed property
    [JsonIgnore]
    public Knowledge Knowledge { get; private set; }

    // Internal storage for the raw JSON
    [JsonPropertyName("knowledge")]
    [JsonInclude]
    internal JsonElement? KnowledgeElement
    {
        get => default;
        set
        {
            if(value is not null)
            {
                Knowledge = ParseKnowledge((JsonElement)value, KnowledgeType);
            }
        }
    }

    private static Knowledge ParseKnowledge(JsonElement element, string type)
    {
        return type switch
        {
            KnowledgeTypes.Entity => element.Deserialize<ConcreteEntity>(),
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

