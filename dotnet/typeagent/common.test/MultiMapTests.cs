// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Common;

namespace common.test;

public class MultiMapTests
{
    [Fact]
    public void Constructor_Default_CreatesEmptyMultiMap()
    {
        // Arrange & Act
        var multiMap = new MultiMap<string, int>();

        // Assert
        Assert.Equal(0, multiMap.Count);
    }

    [Fact]
    public void Constructor_WithValues_InitializesMultiMap()
    {
        // Arrange
        var values = new[]
        {
            new KeyValuePair<string, int>("key1", 1),
            new KeyValuePair<string, int>("key1", 2),
            new KeyValuePair<string, int>("key2", 3)
        };

        // Act
        var multiMap = new MultiMap<string, int>(values);

        // Assert
        Assert.Equal(2, multiMap.Count);
        Assert.Equivalent(new[] { 1, 2 }, multiMap["key1"]);
        Assert.Equivalent(new[] { 3 }, multiMap["key2"]);
    }

    [Fact]
    public void Constructor_WithComparer_UsesCustomComparer()
    {
        // Arrange & Act
        var multiMap = new MultiMap<string, int>(StringComparer.OrdinalIgnoreCase);
        multiMap.Add("KEY", 1);
        multiMap.Add("key", 2);

        // Assert
        Assert.Single(multiMap);
        Assert.Equivalent(new[] { 1, 2 }, multiMap["KEY"]);
    }

    [Fact]
    public void Constructor_WithCapacityAndAllocator_UsesCustomAllocator()
    {
        // Arrange
        var allocatorCalled = false;
        Func<List<int>> customAllocator = () =>
        {
            allocatorCalled = true;
            return new List<int>(10);
        };

        // Act
        var multiMap = new MultiMap<string, int>(10, StringComparer.Ordinal, customAllocator);
        multiMap.Add("key", 1);

        // Assert
        Assert.True(allocatorCalled);
        Assert.Equal(1, multiMap.Count);
    }

    [Fact]
    public void Add_SingleKeyValue_AddsValueToList()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        multiMap.Add("key", 1);
        multiMap.Add("key", 2);

        // Assert
        Assert.Equal(1, multiMap.Count);
        Assert.Equivalent(new[] { 1, 2 }, multiMap["key"]);
    }

    [Fact]
    public void Add_KeyValuePair_AddsValueToList()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        var kvp = new KeyValuePair<string, int>("key", 42);

        // Act
        multiMap.Add(kvp);

        // Assert
        Assert.Equal(1, multiMap.Count);
        Assert.Equivalent(new[] { 42 }, multiMap["key"]);
    }

    [Fact]
    public void Add_MultipleKeyValuePairs_AddsAllValues()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        var values = new[]
        {
            new KeyValuePair<string, int>("a", 1),
            new KeyValuePair<string, int>("b", 2),
            new KeyValuePair<string, int>("a", 3)
        };

        // Act
        multiMap.Add(values);

        // Assert
        Assert.Equal(2, multiMap.Count);
        Assert.Equivalent(new[] { 1, 3 }, multiMap["a"]);
        Assert.Equivalent(new[] { 2 }, multiMap["b"]);
    }

    [Fact]
    public void Add_NullEnumerable_ThrowsArgumentNullException()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        Assert.Throws<ArgumentNullException>(() => multiMap.Add((IEnumerable<KeyValuePair<string, int>>)null!));
    }

    [Fact]
    public void AddUnique_NewValue_AddsValue()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        multiMap.AddUnique("key", 1);
        multiMap.AddUnique("key", 2);

        // Assert
        Assert.Equivalent(new[] { 1, 2 }, multiMap["key"]);
    }

    [Fact]
    public void AddUnique_DuplicateValue_DoesNotAddDuplicate()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        multiMap.AddUnique("key", 1);
        multiMap.AddUnique("key", 1);
        multiMap.AddUnique("key", 2);

        // Assert
        Assert.Equivalent(new[] { 1, 2 }, multiMap["key"]);
    }

    [Fact]
    public void Get_ExistingKey_ReturnsValueList()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        multiMap.Add("key", 1);
        multiMap.Add("key", 2);

        // Act
        var result = multiMap.Get("key");

        // Assert
        Assert.NotNull(result);
        Assert.Equivalent(new[] { 1, 2 }, result);
    }

    [Fact]
    public void Get_NonExistingKey_ReturnsNull()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        var result = multiMap.Get("nonexistent");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void GetOrAdd_ExistingKey_ReturnsExistingList()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        multiMap.Add("key", 1);

        // Act
        var list = multiMap.GetOrAdd("key");
        list.Add(2);

        // Assert
        Assert.Equivalent(new[] { 1, 2 }, multiMap["key"]);
    }

    [Fact]
    public void GetOrAdd_NonExistingKey_CreatesAndReturnsNewList()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        var list = multiMap.GetOrAdd("key");
        list.Add(1);

        // Assert
        Assert.Single(multiMap);
        Assert.Equivalent(new[] { 1 }, multiMap["key"]);
    }

    [Fact]
    public void Remove_ExistingValue_RemovesValue()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        multiMap.Add("key", 1);
        multiMap.Add("key", 2);
        multiMap.Add("key", 3);

        // Act
        multiMap.Remove("key", 2);

        // Assert
        Assert.Equivalent(new[] { 1, 3 }, multiMap["key"]);
    }

    [Fact]
    public void Remove_NonExistingKey_DoesNotThrow()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        multiMap.Remove("nonexistent", 1);

        // Assert - no exception thrown
        Assert.Equal(0, multiMap.Count);
    }

    [Fact]
    public void Remove_NonExistingValue_DoesNotModifyList()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        multiMap.Add("key", 1);
        multiMap.Add("key", 2);

        // Act
        multiMap.Remove("key", 99);

        // Assert
        Assert.Equivalent(new[] { 1, 2 }, multiMap["key"]);
    }

    [Fact]
    public void ForEach_ExecutesActionOnAllValues()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        multiMap.Add("a", 1);
        multiMap.Add("a", 2);
        multiMap.Add("b", 3);
        var values = new List<int>();

        // Act
        multiMap.ForEach(v => values.Add(v));

        // Assert
        Assert.Equal(3, values.Count);
        Assert.Equivalent(new[] { 1, 2, 3 }, values);
    }

    [Fact]
    public void ForEach_NullAction_ThrowsArgumentNullException()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        Assert.Throws<ArgumentNullException>(() => multiMap.ForEach((Action<int>)null!));
    }

    [Fact]
    public void ForEachList_ExecutesActionOnAllLists()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        multiMap.Add("a", 1);
        multiMap.Add("a", 2);
        multiMap.Add("b", 3);
        var listCount = 0;

        // Act
        multiMap.ForEachList(list => listCount++);

        // Assert
        Assert.Equal(2, listCount);
    }

    [Fact]
    public void ForEachList_NullAction_ThrowsArgumentNullException()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        Assert.Throws<ArgumentNullException>(() => multiMap.ForEachList((Action<List<int>>)null!));
    }

    [Fact]
    public void TrimExcess_TrimsAllLists()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        multiMap.Add("key", 1);

        // Act
        multiMap.TrimExcess();

        // Assert - no exception, capacity is trimmed
        Assert.Equal(1, multiMap.Count);
    }

    [Fact]
    public void IEnumerableOfTValue_EnumeratesAllValues()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();
        multiMap.Add("a", 1);
        multiMap.Add("a", 2);
        multiMap.Add("b", 3);

        // Act
        var values = ((IEnumerable<int>)multiMap).ToList();

        // Assert
        Assert.Equal(3, values.Count);
        Assert.Equivalent(new[] { 1, 2, 3 }, values);
    }

    [Fact]
    public void MultiMap_AllowsDuplicateValues()
    {
        // Arrange
        var multiMap = new MultiMap<string, int>();

        // Act
        multiMap.Add("key", 1);
        multiMap.Add("key", 1);
        multiMap.Add("key", 1);

        // Assert
        Assert.Equivalent(new[] { 1, 1, 1 }, multiMap["key"]);
    }

    [Fact]
    public void MultiMap_SupportsComplexTypes()
    {
        // Arrange
        var multiMap = new MultiMap<int, string>();

        // Act
        multiMap.Add(1, "apple");
        multiMap.Add(1, "apricot");
        multiMap.Add(2, "banana");

        // Assert
        Assert.Equal(2, multiMap.Count);
        Assert.Equivalent(new[] { "apple", "apricot" }, multiMap[1]);
        Assert.Equivalent(new[] { "banana" }, multiMap[2]);
    }
}
