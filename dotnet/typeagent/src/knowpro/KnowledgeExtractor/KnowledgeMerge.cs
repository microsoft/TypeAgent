// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public static class KnowledgeMergeExtensions
{
}

internal class MergedKnowledge
{
    HashSet<int>? SourceMessageOrdinals { get; set; } = null;

}

internal class MergedEntity : MergedKnowledge
{
    public string Name { get; set; }

    public string[] Type { get; set; }

    public MergedFacets? Facets { get; set; } = null;
}

internal class MergedTopic : MergedKnowledge
{
    public Topic Topic { get; set; }
}

internal class MergedFacets : Multiset<string, string>
{

}
