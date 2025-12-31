// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using TypeAgent.Common;
using Xunit;

namespace common.test;

public class TopNCollectionTests
{
    [Fact]
    public void Constructor_WithValidMaxCount_CreatesEmptyCollection()
    {
        var collection = new TopNCollection<string>(5);

        Assert.Equal(0, collection.Count);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-100)]
    public void Constructor_WithInvalidMaxCount_ThrowsException(int maxCount)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new TopNCollection<string>(maxCount));
    }

    [Fact]
    public void Add_SingleItem_IncrementsCount()
    {
        var collection = new TopNCollection<string>(5);

        collection.Add("item1", 0.5);

        Assert.Equal(1, collection.Count);
    }

    [Fact]
    public void Add_MultipleItems_TracksCorrectCount()
    {
        var collection = new TopNCollection<int>(5);

        collection.Add(1, 0.1);
        collection.Add(2, 0.2);
        collection.Add(3, 0.3);

        Assert.Equal(3, collection.Count);
    }

    [Fact]
    public void Add_MoreThanMaxCount_MaintainsMaxCount()
    {
        var collection = new TopNCollection<int>(3);

        collection.Add(1, 0.1);
        collection.Add(2, 0.2);
        collection.Add(3, 0.3);
        collection.Add(4, 0.4);
        collection.Add(5, 0.5);

        Assert.Equal(3, collection.Count);
    }

    [Fact]
    public void Add_MoreThanMaxCount_KeepsHighestScores()
    {
        var collection = new TopNCollection<int>(3);

        collection.Add(1, 0.1);
        collection.Add(2, 0.5);
        collection.Add(3, 0.3);
        collection.Add(4, 0.9);
        collection.Add(5, 0.2);

        var results = collection.ByRankAndClear();

        Assert.Equal(3, results.Count);
        Assert.Contains(results, r => r.Item == 2 && r.Score == 0.5);
        Assert.Contains(results, r => r.Item == 3 && r.Score == 0.3);
        Assert.Contains(results, r => r.Item == 4 && r.Score == 0.9);
    }

    [Fact]
    public void Add_ItemWithLowerScoreThanAll_IsDiscarded()
    {
        var collection = new TopNCollection<string>(2);

        collection.Add("high", 0.9);
        collection.Add("medium", 0.5);
        collection.Add("low", 0.1);

        var results = collection.ByRankAndClear();

        Assert.Equal(2, results.Count);
        Assert.DoesNotContain(results, r => r.Item == "low");
    }

    [Fact]
    public void Add_EnumerableOfScoredItems_AddsAllItems()
    {
        var collection = new TopNCollection<string>(5);
        var items = new List<Scored<string>>
        {
            new("a", 0.1),
            new("b", 0.2),
            new("c", 0.3)
        };

        collection.Add(items);

        Assert.Equal(3, collection.Count);
    }

    [Fact]
    public void Add_NullEnumerable_ThrowsException()
    {
        var collection = new TopNCollection<string>(5);

        Assert.Throws<ArgumentNullException>(() => collection.Add((IEnumerable<Scored<string>>)null!));
    }

    [Fact]
    public void GetTop_ReturnsLowestScoredItem()
    {
        var collection = new TopNCollection<string>(3);

        collection.Add("high", 0.9);
        collection.Add("low", 0.1);
        collection.Add("medium", 0.5);

        var top = collection.GetTop();

        Assert.Equal("low", top.Item);
        Assert.Equal(0.1, top.Score);
    }

    [Fact]
    public void GetTop_EmptyCollection_ThrowsException()
    {
        var collection = new TopNCollection<string>(5);

        Assert.Throws<TypeAgentException>(() => collection.GetTop());
    }

    [Fact]
    public void Clear_ResetsCount()
    {
        var collection = new TopNCollection<int>(5);
        collection.Add(1, 0.5);
        collection.Add(2, 0.6);

        collection.Clear();

        Assert.Equal(0, collection.Count);
    }

    [Fact]
    public void ByRankAndClear_ReturnsSortedDescending()
    {
        var collection = new TopNCollection<string>(5);

        collection.Add("low", 0.1);
        collection.Add("high", 0.9);
        collection.Add("medium", 0.5);

        var results = collection.ByRankAndClear();

        Assert.Equal(3, results.Count);
        Assert.Equal("high", results[0].Item);
        Assert.Equal("medium", results[1].Item);
        Assert.Equal("low", results[2].Item);
    }

    [Fact]
    public void ByRankAndClear_EmptyCollection_ReturnsEmptyList()
    {
        var collection = new TopNCollection<string>(5);

        var results = collection.ByRankAndClear();

        Assert.Empty(results);
    }

    [Fact]
    public void ByRankAndClear_ClearsCollection()
    {
        var collection = new TopNCollection<int>(5);
        collection.Add(1, 0.5);

        collection.ByRankAndClear();

        Assert.Equal(1, collection.Count);
    }

    // Static factory method tests
    [Fact]
    public void Create_WithPositiveMaxMatches_ReturnsTopNCollection()
    {
        var collection = TopNCollection.Create<string>(5);

        Assert.IsType<TopNCollection<string>>(collection);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Create_WithZeroOrNegativeMaxMatches_ReturnsCollectAllCollection(int maxMatches)
    {
        var collection = TopNCollection.Create<string>(maxMatches);

        Assert.IsType<CollectAllCollection<string>>(collection);
    }

    // CollectAllCollection tests
    [Fact]
    public void CollectAll_AddsAllItems()
    {
        var collection = new CollectAllCollection<int>();

        collection.Add(1, 0.1);
        collection.Add(2, 0.2);
        collection.Add(3, 0.3);

        Assert.Equal(3, collection.Count);
    }

    [Fact]
    public void CollectAll_ByRankAndClear_ReturnsSortedAscending()
    {
        var collection = new CollectAllCollection<string>();

        collection.Add("high", 0.9);
        collection.Add("low", 0.1);
        collection.Add("medium", 0.5);

        var results = collection.ByRankAndClear();

        Assert.Equal(3, results.Count);
        Assert.Equal("low", results[0].Item);
        Assert.Equal("medium", results[1].Item);
        Assert.Equal("high", results[2].Item);
    }

    [Fact]
    public void CollectAll_EmptyCollection_CountIsZero()
    {
        var collection = new CollectAllCollection<string>();

        Assert.Equal(0, collection.Count);
    }

    [Fact]
    public void CollectAll_AddRange_AddsAllItems()
    {
        var collection = new CollectAllCollection<string>();
        var items = new List<Scored<string>>
        {
            new("a", 0.1),
            new("b", 0.2)
        };

        collection.Add(items);

        Assert.Equal(2, collection.Count);
    }
}
