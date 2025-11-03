// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public partial class ActionEx : TypeAgent.KnowPro.Action
{
    [JsonPropertyName("inverseVerbs")]
    public string[]? InverseVerbs { get; set; }
}

public partial class ExtractedKnowledge
{
    [JsonPropertyName("entities")]
    [JsonRequired]
    public ConcreteEntity[] Entities { get; set; }

    [JsonPropertyName("actions")]
    [JsonRequired]
    public ActionEx[] Actions { get; set; }

    [JsonPropertyName("topics")]
    public string[] Topics { get; set; }
}
