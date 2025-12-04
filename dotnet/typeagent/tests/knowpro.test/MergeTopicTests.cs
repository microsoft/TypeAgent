// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;
public class MergeTopicTests
{
    [Fact]
    public void EntityUnionTest()
    {
        MergedEntity me = new MergedEntity()
        {
            Name = "MergedEntity",
            Type = ["type0"]
        };

        MergedEntity me2 = new MergedEntity()
        {
            Name = "MergedEntity",
            Type = ["type1"]
        };

        MergedEntity ue = new MergedEntity()
        {
            Name = "UnionEntity",
            Type = ["type2"]
        };

        Assert.False(MergedEntity.Union(me, ue));
        Assert.True(MergedEntity.Union(me, me2));
        Assert.Equal(2, me.Type.Count);
    }

    [Fact]
    public void EntityMergeTest()
    {
        List<ConcreteEntity> entities = [
            new ConcreteEntity("Mike", "doctor"),
            new ConcreteEntity("Mike", "doctor")
        ];

        var merged = MergedEntity.Merge(entities);
        Assert.Single(merged);

        entities = [
            new ConcreteEntity("Michael", "person"),
            new ConcreteEntity("Mike", "doctor"),
            new ConcreteEntity("Michael", "father"),
            new ConcreteEntity("Michael", "American"),
            new ConcreteEntity("Mike", "doctor")
        ];

        merged = MergedEntity.Merge(entities);

        Assert.Equal(2, merged.Count());
        Assert.Equal(3, merged.First().Type.Length);
    }

    [Fact]
    public void TopicMergeTest()
    {
        Assert.Throws<ArgumentNullException>(() => MergedTopic.Merge(null!));

        List<Topic> topics = [
            new Topic("topic1"),
            new Topic ("Topic1")
        ];

        var merged = MergedTopic.Merge(topics);
        Assert.Single(merged);

        topics = [
            new Topic("topic1"),
            new Topic("topic2")
        ];

        merged = MergedTopic.Merge(topics);
        Assert.Equal(2, topics.Count);
    }

    [Fact]
    public void SemanticRefMergeTest()
    {
        List<Scored<SemanticRef>> refs = [
            new Scored<SemanticRef>(new SemanticRef(new Topic("topic1"), new TextRange(0)), 1),
            new Scored<SemanticRef>(new SemanticRef(new ConcreteEntity("entity", "dummy"), new TextRange(0)), 100)
        ];

        var merged = MergedTopic.Merge(refs, false);
        Assert.Single(merged);


        refs = [
            new Scored<SemanticRef>(new SemanticRef(new Topic("topic1"), new TextRange(0)), 99),
            new Scored<SemanticRef>(new SemanticRef(new Topic("topic2"), new TextRange(0)), 100),
            new Scored<SemanticRef>(new SemanticRef(new Topic("topic1"), new TextRange(0)), 1)
        ];

        merged = MergedTopic.Merge(refs, true);
        Assert.Equal(2, merged.Count);
        Assert.Equal(99, merged.First().Value.Score);
        Assert.Equal(100, merged.Last().Value.Score);
    }

    [Fact]
    public void FacetUnionTest()
    {
        MergedFacets f1 = new MergedFacets(new FacetComparer())
        {
            { "Facet1", "value1" },
            { "Facet2", "value2" }
        };

        MergedFacets f2 = new MergedFacets(new FacetComparer())
        {
            { "Facet1", "value1" },
            { "Facet2", "value22" },
            { "Facet3", "value3" }
        };

        var merged = MergedFacets.Union(f1, f2);

        Assert.Equal(3, merged.Count);
        Assert.Single(merged["Facet1"]);
        Assert.Equal(2, merged["Facet2"].Count);
    }

    public class FacetComparer : IEqualityComparer<string>
    {
        public bool Equals(string? x, string? y)
        {
            return x == y;
        }

        public int GetHashCode([DisallowNull] string obj)
        {
            return obj.GetHashCode();
        }
    }
}
