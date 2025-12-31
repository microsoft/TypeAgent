// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;

public class KnowledgeSchemaTests
{
    [Fact]
    public void CreateConcreteEntityTest()
    {
        var entity = new ConcreteEntity("test entity", ["test", "object", "blah"]);

        Assert.True(entity.HasName);
        Assert.True(entity.HasTypes);
        Assert.False(entity.HasFacets);
    }

    [Fact]
    public void MergeEntityFacetTest()
    {
        var entity = new ConcreteEntity("test entity", ["test", "object", "blah"]);

        Assert.False(entity.HasFacets);
        entity.MergeEntityFacet(new Facet() { Name = "facet1" });
        Assert.True(entity.HasFacets);
        Assert.Single(entity.Facets!);

        entity.MergeEntityFacet(new Facet() { Name = "facet2" });
        Assert.Equal(2, entity.Facets!.Length);
    }

    [Fact]
    public void ActionEntityTest()
    {
        var action = new TypeAgent.KnowPro.Action();

        Assert.Equal(KnowledgeType.Action, action.KnowledgeType);
        Assert.False(action.HasSubject);
        Assert.False(action.HasObject);
        Assert.False(action.HasVerbs);

        action.VerbTense = "present";
        action.Verbs = ["yes", "no"];
        action.SubjectEntityName = "subject";
        action.ObjectEntityName = "object";
        action.SubjectEntityFacet = new Facet() { Name = "facet1" };
    }
}
