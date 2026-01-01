// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using TypeAgent.Common;
using TypeAgent.KnowPro;
using TypeAgent.KnowPro.Storage.Sqlite;

namespace knowproStorage.test;

public sealed class SqliteSemanticRefCollectionTests : IDisposable
{
    private readonly string _testDbPath;
    private readonly SqliteDatabase _db;
    private readonly SqliteSemanticRefCollection _collection;

    public SqliteSemanticRefCollectionTests()
    {
        _testDbPath = Path.Combine(Path.GetTempPath(), $"test_semref_{Guid.NewGuid()}.db");
        _db = new SqliteDatabase(_testDbPath, createNew: true);
        _db.Execute(SqliteStorageProviderSchema.SemanticRefsSchema);
        _collection = new SqliteSemanticRefCollection(_db);
    }

    public void Dispose()
    {
        _db?.Dispose();
        if (File.Exists(_testDbPath))
        {
            File.Delete(_testDbPath);
        }
    }

    #region Helper Methods

    private static SemanticRef CreateSemanticRef(int ordinal, string topicText = "TestTopic")
    {
        return new SemanticRef(new Topic(topicText), new TextRange(ordinal))
        {
            SemanticRefOrdinal = ordinal
        };
    }

    private static SemanticRef CreateEntitySemanticRef(int ordinal, string name = "TestEntity")
    {
        return new SemanticRef(new ConcreteEntity(name, "person"), new TextRange(ordinal))
        {
            SemanticRefOrdinal = ordinal
        };
    }

    private static SemanticRef CreateActionSemanticRef(int ordinal)
    {
        var action = new TypeAgent.KnowPro.Action
        {
            Verbs = ["run", "walk"],
            VerbTense = "past",
            SubjectEntityName = "John"
        };
        return new SemanticRef(action, new TextRange(ordinal))
        {
            SemanticRefOrdinal = ordinal
        };
    }

    #endregion

    #region Constructor Tests

    [Fact]
    public void Constructor_WithNullDatabase_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => new SqliteSemanticRefCollection(null!));
    }

    [Fact]
    public void Constructor_WithValidDatabase_CreatesInstance()
    {
        var collection = new SqliteSemanticRefCollection(_db);
        Assert.NotNull(collection);
    }

    #endregion

    #region IsPersistent Tests

    [Fact]
    public void IsPersistent_ReturnsTrue()
    {
        Assert.True(_collection.IsPersistent);
    }

    #endregion

    #region GetCount Tests

    [Fact]
    public void GetCount_EmptyCollection_ReturnsZero()
    {
        Assert.Equal(0, _collection.GetCount());
    }

    [Fact]
    public void GetCount_AfterAppend_ReturnsCorrectCount()
    {
        _collection.Append(CreateSemanticRef(0));
        _collection.Append(CreateSemanticRef(1));
        _collection.Append(CreateSemanticRef(2));

        Assert.Equal(3, _collection.GetCount());
    }

    [Fact]
    public async Task GetCountAsync_ReturnsCorrectCount()
    {
        _collection.Append(CreateSemanticRef(0));

        var count = await _collection.GetCountAsync();

        Assert.Equal(1, count);
    }

    #endregion

    #region Append Tests

    [Fact]
    public void Append_ValidSemanticRef_AddsToCollection()
    {
        var semanticRef = CreateSemanticRef(0);

        _collection.Append(semanticRef);

        Assert.Equal(1, _collection.GetCount());
    }

    [Fact]
    public void Append_MultipleSemanticRefs_AddsAllToCollection()
    {
        for (int i = 0; i < 5; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        Assert.Equal(5, _collection.GetCount());
    }

    [Fact]
    public void Append_WithNegativeOrdinal_AssignsNextOrdinal()
    {
        var semanticRef = new SemanticRef(new Topic("Test"), new TextRange(0))
        {
            SemanticRefOrdinal = -1
        };

        _collection.Append(semanticRef);

        var retrieved = _collection.Get(0);
        Assert.Equal(0, retrieved.SemanticRefOrdinal);
    }

    [Fact]
    public async Task AppendAsync_SingleItem_AddsToCollection()
    {
        var semanticRef = CreateSemanticRef(0);

        await _collection.AppendAsync(semanticRef);

        Assert.Equal(1, _collection.GetCount());
    }

    [Fact]
    public async Task AppendAsync_MultipleItems_AddsAllToCollection()
    {
        var items = new List<SemanticRef>
        {
            CreateSemanticRef(0),
            CreateSemanticRef(1),
            CreateSemanticRef(2)
        };

        await _collection.AppendAsync(items);

        Assert.Equal(3, _collection.GetCount());
    }

    [Fact]
    public async Task AppendAsync_WithNullList_ThrowsArgumentNullException()
    {
        await Assert.ThrowsAsync<ArgumentNullException>(
            async () => await _collection.AppendAsync((IList<SemanticRef>)null!));
    }

    [Fact]
    public async Task AppendAsync_WithCancellationToken_RespectsToken()
    {
        var cts = new CancellationTokenSource();
        var items = Enumerable.Range(0, 100).Select(i => CreateSemanticRef(i)).ToList();

        cts.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(
            () => _collection.AppendAsync(items, cts.Token).AsTask());
    }

    #endregion

    #region Get Tests

    [Fact]
    public void Get_ValidId_ReturnsSemanticRef()
    {
        var expected = CreateSemanticRef(0, "TopicText");
        _collection.Append(expected);

        var result = _collection.Get(0);

        Assert.NotNull(result);
        Assert.Equal(0, result.SemanticRefOrdinal);
        Assert.Equal(KnowledgeType.Topic, result.KnowledgeType);
    }

    [Fact]
    public void Get_InvalidId_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() => _collection.Get(999));
    }

    [Fact]
    public void Get_NegativeId_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => _collection.Get(-1));
    }

    [Fact]
    public async Task GetAsync_ValidId_ReturnsSemanticRef()
    {
        _collection.Append(CreateSemanticRef(0));

        var result = await _collection.GetAsync(0);

        Assert.NotNull(result);
        Assert.Equal(0, result.SemanticRefOrdinal);
    }

    [Fact]
    public async Task GetAsync_MultipleIds_ReturnsAllSemanticRefs()
    {
        for (int i = 0; i < 5; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        var ids = new List<int> { 0, 2, 4 };
        var results = await _collection.GetAsync(ids);

        Assert.Equal(3, results.Count);
        Assert.Contains(results, r => r.SemanticRefOrdinal == 0);
        Assert.Contains(results, r => r.SemanticRefOrdinal == 2);
        Assert.Contains(results, r => r.SemanticRefOrdinal == 4);
    }

    [Fact]
    public async Task GetAsync_EmptyIdList_ThrowsArgumentException()
    {
        await Assert.ThrowsAsync<ArgumentException>(
            () => _collection.GetAsync(new List<int>()).AsTask());
    }

    [Fact]
    public async Task GetAsync_NullIdList_ThrowsArgumentNullException()
    {
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => _collection.GetAsync((IList<int>)null!).AsTask());
    }

    #endregion

    #region GetRange Tests

    [Fact]
    public void GetRange_ValidId_ReturnsTextRange()
    {
        var semanticRef = CreateSemanticRef(0);
        _collection.Append(semanticRef);

        var range = _collection.GetRange(0);

        Assert.NotNull(range);
        Assert.Equal(0, range.Start.MessageOrdinal);
    }

    [Fact]
    public void GetRange_NegativeId_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => _collection.GetRange(-1));
    }

    [Fact]
    public async Task GetTextRangeAsync_SingleId_ReturnsTextRange()
    {
        _collection.Append(CreateSemanticRef(0));

        var range = await _collection.GetTextRangeAsync(0);

        Assert.NotNull(range);
    }

    [Fact]
    public async Task GetTextRangeAsync_MultipleIds_ReturnsAllTextRanges()
    {
        for (int i = 0; i < 3; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        var ids = new List<int> { 0, 1, 2 };
        var ranges = await _collection.GetTextRangeAsync(ids);

        Assert.Equal(3, ranges.Count);
    }

    #endregion

    #region GetKnowledgeType Tests

    [Fact]
    public void GetKnowledgeType_TopicRef_ReturnsTopic()
    {
        _collection.Append(CreateSemanticRef(0));

        var knowledgeType = _collection.GetKnowledgeType(0);

        Assert.Equal(KnowledgeType.Topic, knowledgeType);
    }

    [Fact]
    public void GetKnowledgeType_EntityRef_ReturnsEntity()
    {
        _collection.Append(CreateEntitySemanticRef(0));

        var knowledgeType = _collection.GetKnowledgeType(0);

        Assert.Equal(KnowledgeType.Entity, knowledgeType);
    }

    [Fact]
    public void GetKnowledgeType_ActionRef_ReturnsAction()
    {
        _collection.Append(CreateActionSemanticRef(0));

        var knowledgeType = _collection.GetKnowledgeType(0);

        Assert.Equal(KnowledgeType.Action, knowledgeType);
    }

    [Fact]
    public async Task GetKnowledgeTypeAsync_SingleId_ReturnsKnowledgeType()
    {
        _collection.Append(CreateSemanticRef(0));

        var knowledgeType = await _collection.GetKnowledgeTypeAsync(0);

        Assert.Equal(KnowledgeType.Topic, knowledgeType);
    }

    [Fact]
    public async Task GetKnowledgeTypeAsync_MultipleIds_ReturnsAllKnowledgeTypes()
    {
        _collection.Append(CreateSemanticRef(0));
        _collection.Append(CreateEntitySemanticRef(1));
        _collection.Append(CreateActionSemanticRef(2));

        var ids = new List<int> { 0, 1, 2 };
        var types = await _collection.GetKnowledgeTypeAsync(ids);

        Assert.Equal(3, types.Count);
        Assert.Equal(KnowledgeType.Topic, types[0]);
        Assert.Equal(KnowledgeType.Entity, types[1]);
        Assert.Equal(KnowledgeType.Action, types[2]);
    }

    #endregion

    #region GetSlice Tests

    [Fact]
    public void GetSlice_ValidRange_ReturnsSemanticRefs()
    {
        for (int i = 0; i < 10; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        var slice = _collection.GetSlice(2, 5);

        Assert.Equal(3, slice.Count);
        Assert.Equal(2, slice[0].SemanticRefOrdinal);
        Assert.Equal(3, slice[1].SemanticRefOrdinal);
        Assert.Equal(4, slice[2].SemanticRefOrdinal);
    }

    [Fact]
    public void GetSlice_StartGreaterThanEnd_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => _collection.GetSlice(5, 2));
    }

    [Fact]
    public void GetSlice_EmptyRange_ReturnsEmptyList()
    {
        for (int i = 0; i < 5; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        var slice = _collection.GetSlice(3, 3);

        Assert.Empty(slice);
    }

    [Fact]
    public async Task GetSliceAsync_ValidRange_ReturnsSemanticRefs()
    {
        for (int i = 0; i < 5; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        var slice = await _collection.GetSliceAsync(1, 4);

        Assert.Equal(3, slice.Count);
    }

    #endregion

    #region GetAll Tests

    [Fact]
    public void GetAll_NoFilter_ReturnsAllSemanticRefs()
    {
        _collection.Append(CreateSemanticRef(0));
        _collection.Append(CreateEntitySemanticRef(1));
        _collection.Append(CreateActionSemanticRef(2));

        var all = _collection.GetAll();

        Assert.Equal(3, all.Count);
    }

    [Fact]
    public void GetAll_WithKnowledgeTypeFilter_ReturnsFilteredResults()
    {
        _collection.Append(CreateSemanticRef(0));
        _collection.Append(CreateSemanticRef(1));
        _collection.Append(CreateEntitySemanticRef(2));

        var topics = _collection.GetAll(KnowledgeType.Topic);

        Assert.Equal(2, topics.Count);
        Assert.All(topics, t => Assert.Equal(KnowledgeType.Topic, t.KnowledgeType));
    }

    [Fact]
    public async Task GetAllAsync_ReturnsAllSemanticRefs()
    {
        _collection.Append(CreateSemanticRef(0));
        _collection.Append(CreateEntitySemanticRef(1));

        var all = await _collection.GetAllAsync();

        Assert.Equal(2, all.Count);
    }

    #endregion

    #region GetAllOrdinals Tests

    [Fact]
    public void GetAllOrdinals_NoFilter_ReturnsAllOrdinals()
    {
        for (int i = 0; i < 3; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        var ordinals = _collection.GetAllOrdinals();

        Assert.Equal(3, ordinals.Count);
        Assert.Contains(ordinals, o => o.SemanticRefOrdinal == 0);
        Assert.Contains(ordinals, o => o.SemanticRefOrdinal == 1);
        Assert.Contains(ordinals, o => o.SemanticRefOrdinal == 2);
    }

    [Fact]
    public void GetAllOrdinals_WithKnowledgeTypeFilter_ReturnsFilteredOrdinals()
    {
        _collection.Append(CreateSemanticRef(0));
        _collection.Append(CreateEntitySemanticRef(1));
        _collection.Append(CreateSemanticRef(2));

        var topicOrdinals = _collection.GetAllOrdinals(KnowledgeType.Topic);

        Assert.Equal(2, topicOrdinals.Count);
        Assert.Contains(topicOrdinals, o => o.SemanticRefOrdinal == 0);
        Assert.Contains(topicOrdinals, o => o.SemanticRefOrdinal == 2);
    }

    [Fact]
    public async Task GetAllOrdinalsAsync_ReturnsAllOrdinals()
    {
        _collection.Append(CreateSemanticRef(0));
        _collection.Append(CreateSemanticRef(1));

        var ordinals = await _collection.GetAllOrdinalsAsync();

        Assert.Equal(2, ordinals.Count);
    }

    #endregion

    #region AsyncEnumerator Tests

    [Fact]
    public async Task GetAsyncEnumerator_IteratesOverAllItems()
    {
        for (int i = 0; i < 5; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        var items = new List<SemanticRef>();
        await foreach (var item in _collection)
        {
            items.Add(item);
        }

        Assert.Equal(5, items.Count);
        for (int i = 0; i < 5; i++)
        {
            Assert.Equal(i, items[i].SemanticRefOrdinal);
        }
    }

    [Fact]
    public async Task GetAsyncEnumerator_EmptyCollection_YieldsNoItems()
    {
        var items = new List<SemanticRef>();
        await foreach (var item in _collection)
        {
            items.Add(item);
        }

        Assert.Empty(items);
    }

    #endregion

    #region Serialization Roundtrip Tests

    [Fact]
    public void Append_AndGet_PreservesEntityData()
    {
        var entity = new ConcreteEntity("John Doe", ["person", "employee"]);
        entity.Facets = [new Facet { Name = "age", Value = new StringFacetValue("30") }];

        var semanticRef = new SemanticRef(entity, new TextRange(0, 0))
        {
            SemanticRefOrdinal = 0
        };

        _collection.Append(semanticRef);
        var retrieved = _collection.Get(0);

        Assert.Equal(KnowledgeType.Entity, retrieved.KnowledgeType);
        var retrievedEntity = retrieved.AsEntity();
        Assert.Equal("John Doe", retrievedEntity.Name);
        Assert.Contains("person", retrievedEntity.Type);
        Assert.Contains("employee", retrievedEntity.Type);
        Assert.NotNull(retrievedEntity.Facets);
        Assert.Contains(retrievedEntity.Facets, f => f.Name == "age" && f.Value?.ToString() == "30");
    }

    [Fact]
    public void Append_AndGet_PreservesTopicData()
    {
        var topic = new Topic("Artificial Intelligence");
        var semanticRef = new SemanticRef(topic, new TextRange(5))
        {
            SemanticRefOrdinal = 0
        };

        _collection.Append(semanticRef);
        var retrieved = _collection.Get(0);

        Assert.Equal(KnowledgeType.Topic, retrieved.KnowledgeType);
        var retrievedTopic = retrieved.AsTopic();
        Assert.Equal("Artificial Intelligence", retrievedTopic.Text);
    }

    [Fact]
    public void Append_AndGet_PreservesActionData()
    {
        var action = new TypeAgent.KnowPro.Action
        {
            Verbs = ["discuss", "talk"],
            VerbTense = "present",
            SubjectEntityName = "Alice",
            ObjectEntityName = "Bob"
        };
        var semanticRef = new SemanticRef(action, new TextRange(10))
        {
            SemanticRefOrdinal = 0
        };

        _collection.Append(semanticRef);
        var retrieved = _collection.Get(0);

        Assert.Equal(KnowledgeType.Action, retrieved.KnowledgeType);
        var retrievedAction = retrieved.AsAction();
        Assert.Contains("discuss", retrievedAction.Verbs);
        Assert.Contains("talk", retrievedAction.Verbs);
        Assert.Equal("present", retrievedAction.VerbTense);
        Assert.Equal("Alice", retrievedAction.SubjectEntityName);
        Assert.Equal("Bob", retrievedAction.ObjectEntityName);
    }

    [Fact]
    public void Append_AndGet_PreservesTextRangeWithEnd()
    {
        var start = new TextLocation(5, 2);
        var end = new TextLocation(10, 3);
        var range = new TextRange(start, end);

        var semanticRef = new SemanticRef(new Topic("Test"), range)
        {
            SemanticRefOrdinal = 0
        };

        _collection.Append(semanticRef);
        var retrieved = _collection.Get(0);

        Assert.Equal(5, retrieved.Range.Start.MessageOrdinal);
        Assert.Equal(2, retrieved.Range.Start.ChunkOrdinal);
        Assert.NotNull(retrieved.Range.End);
        Assert.Equal(10, retrieved.Range.End.Value.MessageOrdinal);
        Assert.Equal(3, retrieved.Range.End.Value.ChunkOrdinal);
    }

    #endregion

    #region Event Tests

    [Fact]
    public void NotifyKnowledgeProgress_FiresEvent()
    {
        bool eventFired = false;
        _collection.OnKnowledgeExtracted += (progress) =>
        {
            eventFired = true;
        };

        _collection.NotifyKnowledgeProgress(new BatchProgress(1, 10));

        Assert.True(eventFired);
    }

    [Fact]
    public void NotifyKnowledgeProgress_WithNoSubscribers_DoesNotThrow()
    {
        var exception = Record.Exception(() =>
            _collection.NotifyKnowledgeProgress(new BatchProgress(1, 10)));

        Assert.Null(exception);
    }

    #endregion

    #region Edge Case Tests

    [Fact]
    public void Append_LargeNumber_HandlesCorrectly()
    {
        const int count = 1000;
        for (int i = 0; i < count; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        Assert.Equal(count, _collection.GetCount());
    }

    [Fact]
    public async Task GetAsync_LargeBatch_UsesBatching()
    {
        // Add more than SqliteDatabase.MaxBatchSize items
        const int count = 1500;
        for (int i = 0; i < count; i++)
        {
            _collection.Append(CreateSemanticRef(i));
        }

        var ids = Enumerable.Range(0, count).ToList();
        var results = await _collection.GetAsync(ids);

        Assert.Equal(count, results.Count);
    }

    [Fact]
    public void Get_DifferentKnowledgeTypes_DeserializesCorrectly()
    {
        _collection.Append(CreateSemanticRef(0, "Topic1"));
        _collection.Append(CreateEntitySemanticRef(1, "Entity1"));
        _collection.Append(CreateActionSemanticRef(2));

        var topic = _collection.Get(0);
        var entity = _collection.Get(1);
        var action = _collection.Get(2);

        Assert.Equal(KnowledgeType.Topic, topic.KnowledgeType);
        Assert.Equal(KnowledgeType.Entity, entity.KnowledgeType);
        Assert.Equal(KnowledgeType.Action, action.KnowledgeType);

        Assert.Equal("Topic1", topic.AsTopic().Text);
        Assert.Equal("Entity1", entity.AsEntity().Name);
        Assert.Contains("run", action.AsAction().Verbs);
    }

    #endregion
}
