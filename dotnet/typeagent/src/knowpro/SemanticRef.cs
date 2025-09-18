// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SemanticRef
{
    [JsonPropertyName("semanticRefOrdinal")]
    public int SemanticRefOrdinal { get; set; }

    [JsonPropertyName("range")]
    public TextRange Range { get; set; }

    [JsonPropertyName("knowledgeType")]
    public string KnowledgeType { get; set; }

   // [JsonPropertyName("knowledge")]
    public Knowledge Knowledge { get; set; }
}

public static class KnowledgeType
{
    public const string Entity = "entity";
    public const string Action = "action";
    public const string Topic = "topic";
}

