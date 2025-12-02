// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;

public class SemanticRefTests
{
    [Fact]
    public void SemanticRefAsTagTest()
    {
        Assert.Throws<KnowProException>(() => new SemanticRef().AsTag());

        SemanticRef sr = new SemanticRef(new Tag(), new TextRange(0));
        Assert.NotNull(sr.AsTag());

        sr = new SemanticRef(new StructuredTag(), new TextRange(0));
        Assert.NotNull(sr.AsSTag());
    }

    [Fact]
    public void SemanticRefSerializationTest()
    {

        var json = SemanticRef.SerializeToElement(new ConcreteEntity(), KnowledgeType.EntityTypeName);
        Assert.NotEmpty(json.ToString());

        json = SemanticRef.SerializeToElement(new TypeAgent.KnowPro.Action(), KnowledgeType.ActionTypeName);
        Assert.NotEmpty(json.ToString());

        json = SemanticRef.SerializeToElement(new Topic(), KnowledgeType.TopicTypeName);
        Assert.NotEmpty(json.ToString());

        json = SemanticRef.SerializeToElement(new StructuredTag(), KnowledgeType.STagTypeName);
        Assert.NotEmpty(json.ToString());

        json = SemanticRef.SerializeToElement(new Tag(), KnowledgeType.TagTypeName);
        Assert.NotEmpty(json.ToString());

        Assert.Throws<KnowProException>(() => SemanticRef.SerializeToElement(new SomeNewKnowledge(), nameof(SomeNewKnowledge)));
    }

    internal class SomeNewKnowledge : Knowledge
    {
        public override KnowledgeType KnowledgeType => throw new NotImplementedException();
    }
}
