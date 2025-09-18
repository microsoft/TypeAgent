// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SemanticRef
{
    [JsonPropertyName("semanticRefOrdinal")]
    public SemanticRefOrdinal SemanticRefOrdinal { get; set; }

   // [JsonPropertyName("range")]
    public TextRange Range { get; set; }

   // [JsonPropertyName("knowledgeType")]
    public KnowledgeType KnowledgeType { get; set; }

   // [JsonPropertyName("knowledge")]
    public IKnowledge Knowledge { get; set; }
}
