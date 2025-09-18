// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SemanticRef
{
    public SemanticRefOrdinal SemanticRefOrdinal { get; set; }
    public TextRange Range { get; set; }
    public KnowledgeType KnowledgeType { get; set; }
    public IKnowledge Knowledge { get; set; }
}
