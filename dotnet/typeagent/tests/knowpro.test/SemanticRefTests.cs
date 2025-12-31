// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;

public class SemanticRefTests
{
    #region Constructor Tests

    [Fact]
    public void Constructor_DefaultConstructor_CreatesEmptyInstance()
    {
        // Act
        var sr = new SemanticRef();

        // Assert
        Assert.Equal(-1, sr.SemanticRefOrdinal);
        Assert.Null(sr.Knowledge);
        Assert.Null(sr.Range);
        Assert.Equal(default, sr.KnowledgeType);
    }

    [Fact]
    public void Constructor_WithKnowledgeAndRange_SetsProperties()
    {
        // Arrange
        var entity = new ConcreteEntity("TestEntity", "person");
        var range = new TextRange(0);

        // Act
        var sr = new SemanticRef(entity, range);

        // Assert
        Assert.NotNull(sr.Knowledge);
        Assert.Equal(entity, sr.Knowledge);
        Assert.Equal(KnowledgeType.Entity, sr.KnowledgeType);
        Assert.Equal(range, sr.Range);
    }

    [Fact]
    public void Constructor_WithNullKnowledge_ThrowsArgumentNullException()
    {
        // Arrange
        var range = new TextRange(0);

        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new SemanticRef(null, range));
    }

    [Fact]
    public void Empty_ReturnsDefaultInstance()
    {
        // Act
        var empty = SemanticRef.Empty;

        // Assert
        Assert.NotNull(empty);
        Assert.Equal(-1, empty.SemanticRefOrdinal);
        Assert.Null(empty.Knowledge);
    }

    #endregion

    #region AsEntity Tests

    [Fact]
    public void AsEntity_WithEntityKnowledgeType_ReturnsEntity()
    {
        // Arrange
        var entity = new ConcreteEntity("TestEntity", "person");
        var sr = new SemanticRef(entity, new TextRange(0));

        // Act
        var result = sr.AsEntity();

        // Assert
        Assert.NotNull(result);
        Assert.Equal(entity, result);
        Assert.Equal("TestEntity", result.Name);
    }

    [Fact]
    public void AsEntity_WithNonEntityKnowledgeType_ThrowsException()
    {
        // Arrange
        var topic = new Topic("TestTopic");
        var sr = new SemanticRef(topic, new TextRange(0));

        // Act & Assert
        var ex = Assert.Throws<KnowProException>(() => sr.AsEntity());
        Assert.Equal(KnowProException.ErrorCode.InvalidKnowledgeTypeMismatch, ex.Error);
    }

    #endregion

    #region AsAction Tests

    [Fact]
    public void AsAction_WithActionKnowledgeType_ReturnsAction()
    {
        // Arrange
        var action = new TypeAgent.KnowPro.Action { Verbs = ["run"], VerbTense = "past" };
        var sr = new SemanticRef(action, new TextRange(0));

        // Act
        var result = sr.AsAction();

        // Assert
        Assert.NotNull(result);
        Assert.Equal(action, result);
    }

    [Fact]
    public void AsAction_WithNonActionKnowledgeType_ThrowsException()
    {
        // Arrange
        var entity = new ConcreteEntity("Test", "person");
        var sr = new SemanticRef(entity, new TextRange(0));

        // Act & Assert
        var ex = Assert.Throws<KnowProException>(() => sr.AsAction());
        Assert.Equal(KnowProException.ErrorCode.InvalidKnowledgeTypeMismatch, ex.Error);
    }

    #endregion

    #region AsTopic Tests

    [Fact]
    public void AsTopic_WithTopicKnowledgeType_ReturnsTopic()
    {
        // Arrange
        var topic = new Topic("TestTopic");
        var sr = new SemanticRef(topic, new TextRange(0));

        // Act
        var result = sr.AsTopic();

        // Assert
        Assert.NotNull(result);
        Assert.Equal(topic, result);
        Assert.Equal("TestTopic", result.Text);
    }

    [Fact]
    public void AsTopic_WithNonTopicKnowledgeType_ThrowsException()
    {
        // Arrange
        var entity = new ConcreteEntity("Test", "person");
        var sr = new SemanticRef(entity, new TextRange(0));

        // Act & Assert
        var ex = Assert.Throws<KnowProException>(() => sr.AsTopic());
        Assert.Equal(KnowProException.ErrorCode.InvalidKnowledgeTypeMismatch, ex.Error);
    }

    #endregion

    #region AsTag Tests

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
    public void AsTag_WithTagKnowledgeType_ReturnsTag()
    {
        // Arrange
        var tag = new Tag { Text = "TestTag" };
        var sr = new SemanticRef(tag, new TextRange(0));

        // Act
        var result = sr.AsTag();

        // Assert
        Assert.NotNull(result);
        Assert.Equal(tag, result);
        Assert.Equal("TestTag", result.Text);
    }

    [Fact]
    public void AsTag_WithNonTagKnowledgeType_ThrowsException()
    {
        // Arrange
        var entity = new ConcreteEntity("Test", "person");
        var sr = new SemanticRef(entity, new TextRange(0));

        // Act & Assert
        var ex = Assert.Throws<KnowProException>(() => sr.AsTag());
        Assert.Equal(KnowProException.ErrorCode.InvalidKnowledgeTypeMismatch, ex.Error);
    }

    #endregion

    #region AsSTag Tests

    [Fact]
    public void AsSTag_WithSTagKnowledgeType_ReturnsStructuredTag()
    {
        // Arrange
        var sTag = new StructuredTag { Name = "TestSTag", Type = ["category"] };
        var sr = new SemanticRef(sTag, new TextRange(0));

        // Act
        var result = sr.AsSTag();

        // Assert
        Assert.NotNull(result);
        Assert.Equal(sTag, result);
        Assert.Equal("TestSTag", result.Name);
    }

    [Fact]
    public void AsSTag_WithNonSTagKnowledgeType_ThrowsException()
    {
        // Arrange
        var entity = new ConcreteEntity("Test", "person");
        var sr = new SemanticRef(entity, new TextRange(0));

        // Act & Assert
        var ex = Assert.Throws<KnowProException>(() => sr.AsSTag());
        Assert.Equal(KnowProException.ErrorCode.InvalidKnowledgeTypeMismatch, ex.Error);
    }

    #endregion

    #region Serialization Tests

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

    [Fact]
    public void SerializeToElement_WithEntity_ReturnsValidJson()
    {
        // Arrange
        var entity = new ConcreteEntity("John", "person");

        // Act
        var json = SemanticRef.SerializeToElement(entity, KnowledgeType.EntityTypeName);

        // Assert
        Assert.NotEqual(default, json);
        Assert.Contains("John", json.ToString());
    }

    [Fact]
    public void SerializeToElement_WithInvalidType_ThrowsException()
    {
        // Arrange
        var entity = new ConcreteEntity("Test", "person");

        // Act & Assert
        var ex = Assert.Throws<KnowProException>(() => 
            SemanticRef.SerializeToElement(entity, "InvalidType"));
        Assert.Equal(KnowProException.ErrorCode.InvalidKnowledgeType, ex.Error);
    }

    [Fact]
    public void Deserialize_FromString_WithEntity_ReturnsEntity()
    {
        // Arrange
        var entity = new ConcreteEntity("Jane", "person");
        var jsonElement = SemanticRef.SerializeToElement(entity, KnowledgeType.EntityTypeName);
        var json = jsonElement.ToString();

        // Act
        var result = SemanticRef.Deserialize(json, KnowledgeType.EntityTypeName);

        // Assert
        Assert.NotNull(result);
        Assert.IsType<ConcreteEntity>(result);
        var deserialized = (ConcreteEntity)result;
        Assert.Equal("Jane", deserialized.Name);
    }

    [Fact]
    public void Deserialize_FromJsonElement_WithAction_ReturnsAction()
    {
        // Arrange
        var action = new TypeAgent.KnowPro.Action 
        { 
            Verbs = ["speak"], 
            VerbTense = "present",
            SubjectEntityName = "John"
        };
        var jsonElement = SemanticRef.SerializeToElement(action, KnowledgeType.ActionTypeName);

        // Act
        var result = SemanticRef.Deserialize(jsonElement, KnowledgeType.ActionTypeName);

        // Assert
        Assert.NotNull(result);
        Assert.IsType<TypeAgent.KnowPro.Action>(result);
        var deserialized = (TypeAgent.KnowPro.Action)result;
        Assert.Contains("speak", deserialized.Verbs);
    }

    [Fact]
    public void Deserialize_WithInvalidType_ThrowsException()
    {
        // Arrange
        var json = "{}";

        // Act & Assert
        var ex = Assert.Throws<KnowProException>(() => 
            SemanticRef.Deserialize(json, "InvalidType"));
        Assert.Equal(KnowProException.ErrorCode.InvalidKnowledgeType, ex.Error);
    }

    [Fact]
    public void FullRoundTrip_Serialization_PreservesData()
    {
        // Arrange
        var entity = new ConcreteEntity("Alice", "person");
        var sr = new SemanticRef(entity, new TextRange(5)) 
        { 
            SemanticRefOrdinal = 42 
        };

        // Act - Serialize to JSON
        var json = JsonSerializer.Serialize(sr);
        
        // Act - Deserialize back
        var deserialized = JsonSerializer.Deserialize<SemanticRef>(json);

        // Assert
        Assert.NotNull(deserialized);
        Assert.Equal(42, deserialized.SemanticRefOrdinal);
        Assert.Equal(KnowledgeType.Entity, deserialized.KnowledgeType);
        Assert.NotNull(deserialized.Knowledge);
        var deserializedEntity = deserialized.AsEntity();
        Assert.Equal("Alice", deserializedEntity.Name);
    }

    #endregion

    #region Property Tests

    [Fact]
    public void SemanticRefOrdinal_CanSetAndGet()
    {
        // Arrange
        var sr = new SemanticRef();

        // Act
        sr.SemanticRefOrdinal = 100;

        // Assert
        Assert.Equal(100, sr.SemanticRefOrdinal);
    }

    [Fact]
    public void Range_CanSetAndGet()
    {
        // Arrange
        var sr = new SemanticRef();
        var range = new TextRange(10, 20);

        // Act
        sr.Range = range;

        // Assert
        Assert.Equal(range, sr.Range);
    }

    [Fact]
    public void KnowledgeType_IsCorrectForDifferentKnowledgeTypes()
    {
        // Entity
        var entityRef = new SemanticRef(new ConcreteEntity("Test", "person"), new TextRange(0));
        Assert.Equal(KnowledgeType.Entity, entityRef.KnowledgeType);

        // Action
        var actionRef = new SemanticRef(new TypeAgent.KnowPro.Action(), new TextRange(0));
        Assert.Equal(KnowledgeType.Action, actionRef.KnowledgeType);

        // Topic
        var topicRef = new SemanticRef(new Topic("Test"), new TextRange(0));
        Assert.Equal(KnowledgeType.Topic, topicRef.KnowledgeType);

        // Tag
        var tagRef = new SemanticRef(new Tag { Text = "Test" }, new TextRange(0));
        Assert.Equal(KnowledgeType.Tag, tagRef.KnowledgeType);

        // STag
        var sTagRef = new SemanticRef(new StructuredTag(), new TextRange(0));
        Assert.Equal(KnowledgeType.STag, sTagRef.KnowledgeType);
    }

    #endregion

    #region Test Helper Class

    internal class SomeNewKnowledge : Knowledge
    {
        public override KnowledgeType KnowledgeType => throw new NotImplementedException();
    }

    #endregion
}
