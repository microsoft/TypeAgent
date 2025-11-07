// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Immutable;

namespace TypeAgent.KnowPro;

public static class KnowledgeMergeExtensions
{
}

internal class MergedKnowledge
{
    public void MergeMessageOrdinals(SemanticRef sr)
    {
        int ordinal = sr.Range.Start.MessageOrdinal;
        if (ordinal < OrdinalMin)
        {
            OrdinalMin = ordinal;
        }
        if (ordinal > OrdinalMax)
        {
            OrdinalMax = ordinal;
        }
    }

    public int OrdinalMin { get; private set; } = int.MaxValue;

    public int OrdinalMax { get; private set; } = -1;

    public void CollectOrdinals(HashSet<int> ordinals)
    {
        ordinals.Add(OrdinalMin);
        ordinals.Add(OrdinalMax);
    }
}

internal class MergedEntity : MergedKnowledge
{
    public MergedEntity() { }

    public string Name { get; set; }

    public IList<string> Type { get; set; }

    public MergedFacets? Facets { get; set; } = null;

    public ConcreteEntity ToConcrete()
    {
        var entity = new ConcreteEntity
        {
            Name = Name,
            Type = [.. Type],
        };
        if (!Facets.IsNullOrEmpty())
        {
            entity.Facets = [.. Facets.ToFacets()];
        }
        return entity;
    }

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

    public static IEnumerable<ConcreteEntity> Merge(IEnumerable<ConcreteEntity> entities)
    {
        Dictionary<string, MergedEntity> mergedEntities = [];

        foreach (var entity in entities)
        {
            MergedEntity mergedEntity = entity.ToMerged();
            if (mergedEntities.TryGetValue(mergedEntity.Name, out var existing))
            {
                Union(existing, mergedEntity);
            }
            else
            {
                mergedEntities.Add(mergedEntity.Name, mergedEntity);
            }
        }

        return mergedEntities.Values.Select((m) => m.ToConcrete());
    }

    public static Dictionary<string, Scored<MergedEntity>> Merge(
        IEnumerable<Scored<SemanticRef>> semanticRefs,
        bool mergeOrdinals
    )
    {
        Dictionary<string, Scored<MergedEntity>> mergedEntities = [];

        foreach (var scoredEntity in semanticRefs)
        {
            if (scoredEntity.Item.KnowledgeType != KnowledgeType.Entity)
            {
                continue;
            }

            MergedEntity mergedEntity = scoredEntity.Item.AsEntity().ToMerged();
            Scored<MergedEntity>? target = null;
            if (mergedEntities.TryGetValue(mergedEntity.Name, out var existing))
            {
                if (Union(existing.Item, mergedEntity))
                {
                    if (existing.Score < scoredEntity.Score)
                    {
                        existing.Score = scoredEntity.Score;
                    }
                    target = existing;
                }
                else
                {
                    target = null;
                }
            }
            else
            {
                var newMerged = new Scored<MergedEntity>(mergedEntity, scoredEntity.Score);
                mergedEntities.Add(mergedEntity.Name, newMerged);
                target = newMerged;
            }
            if (target is not null && mergeOrdinals)
            {
                target.Value.Item.MergeMessageOrdinals(scoredEntity);
            }
        }

        return mergedEntities;
    }
}

internal class MergedTopic : MergedKnowledge
{
    public string Topic { get; set; }

    public Topic ToTopic() => new Topic(Topic);

    public static IEnumerable<Topic> Merge(IEnumerable<Topic> topics)
    {
        ArgumentVerify.ThrowIfNull(topics, nameof(topics));

        Dictionary<string, Topic> distinct = [];
        foreach (Topic topic in topics)
        {
            distinct.TryAdd(topic.Text.ToLower(), topic);
        }
        return distinct.Values;
    }

    public static Dictionary<string, Scored<MergedTopic>> Merge(
        IEnumerable<Scored<SemanticRef>> semanticRefs,
        bool mergeOrdinals
    )
    {
        Dictionary<string, Scored<MergedTopic>> mergedTopics = [];

        foreach (var scoredTopic in semanticRefs)
        {
            if (scoredTopic.Item.KnowledgeType != KnowledgeType.Topic)
            {
                continue;
            }

            MergedTopic mergedTopic = scoredTopic.Item.AsTopic().ToMerged();
            Scored<MergedTopic>? target = null;
            if (mergedTopics.TryGetValue(mergedTopic.Topic, out var existing))
            {
                if (existing.Score < scoredTopic.Score)
                {
                    existing.Score = scoredTopic.Score;
                }
            }
            else
            {
                var newMerged = new Scored<MergedTopic>(mergedTopic, scoredTopic.Score);
                mergedTopics.Add(mergedTopic.Topic, newMerged);
                target = newMerged;
            }
            if (target is not null && mergeOrdinals)
            {
                target.Value.Item.MergeMessageOrdinals(scoredTopic);
            }
        }

        return mergedTopics;
    }

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

    public IEnumerable<Facet> ToFacets()
    {
        foreach (KeyValuePair<string, List<string>> kv in this)
        {
            if (!kv.Value.IsNullOrEmpty())
            {
                yield return new Facet
                {
                    Name = kv.Key,
                    Value = new StringFacetValue(string.Join("; ", kv.Value))
                };
            }
        }
    }
}
