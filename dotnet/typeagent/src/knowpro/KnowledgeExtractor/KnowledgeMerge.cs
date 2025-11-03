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
    public MergedEntity()
    {

    }

    public string Name { get; set; }

    public IList<string> Type { get; set; }

    public MergedFacets? Facets { get; set; } = null;

    public static bool Union(MergedEntity to, MergedEntity other)
    {
        if (to.Name != other.Name)
        {
            return false;
        }

        to.Type = [.. to.Type.Union(other.Type)];
        to.Facets = MergedFacets.Union(to.Facets, other.Facets);
        return false;
    }
}

internal class MergedTopic : MergedKnowledge
{
    public Topic Topic { get; set; }
}

internal class MergedFacets : Multiset<string, string>
{
    public MergedFacets()
        : base()
    {
    }

    public MergedFacets(IEqualityComparer<string> comparer)
        : base(comparer)
    {
    }

    public static MergedFacets Union(MergedFacets? to, MergedFacets? other)
    {
        if (to is null)
        {
            return other;
        }
        if (other is null)
        {
            return to;
        }

        foreach (var facetName in other.Keys)
        {
            List<string>? facetValues = other.Get(facetName);
            if (!facetValues.IsNullOrEmpty())
            {
                int count = facetValues.Count;
                for (int i = 0; i < count; ++i)
                {
                    to.AddUnique(facetName, facetValues[i]);
                }
            }
        }
        return to;
}

}
