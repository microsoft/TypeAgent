// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Common;
using Xunit;

namespace common.test;

public class ListTests
{
    [Fact]
    public void IsNullOrEmpty_NullList_ReturnsTrue()
    {
        List<int>? list = null;
        Assert.True(list.IsNullOrEmpty());
    }

    [Fact]
    public void IsNullOrEmpty_EmptyList_ReturnsTrue()
    {
        List<int> list = new List<int>();
        Assert.True(list.IsNullOrEmpty());
    }

    [Fact]
    public void IsNullOrEmpty_NonEmptyList_ReturnsFalse()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        Assert.False(list.IsNullOrEmpty());
    }

    [Fact]
    public void GetCount_NullList_ReturnsZero()
    {
        List<int>? list = null;
        Assert.Equal(0, list.GetCount());
    }

    [Fact]
    public void GetCount_EmptyList_ReturnsZero()
    {
        List<int> list = new List<int>();
        Assert.Equal(0, list.GetCount());
    }

    [Fact]
    public void GetCount_NonEmptyList_ReturnsCount()
    {
        List<int> list = new List<int> { 1, 2, 3, 4, 5 };
        Assert.Equal(5, list.GetCount());
    }

    [Fact]
    public void GetOrNull_ValidIndex_ReturnsItem()
    {
        List<string> list = new List<string> { "a", "b", "c" };
        Assert.Equal("b", list.GetOrNull(1));
    }

    [Fact]
    public void GetOrNull_IndexOutOfRange_ReturnsNull()
    {
        List<string> list = new List<string> { "a", "b", "c" };
        Assert.Null(list.GetOrNull(5));
    }

    [Fact]
    public void GetOrNull_NegativeIndex_ReturnsNull()
    {
        List<string> list = new List<string> { "a", "b", "c" };
        Assert.Null(list.GetOrNull(-1));
    }

    [Fact]
    public void AddRange_ValidItems_AddsAllItems()
    {
        List<int> list = new List<int> { 1, 2 };
        list.AddRange(new[] { 3, 4, 5 });
        Assert.Equal(5, list.Count);
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, list);
    }

    [Fact]
    public void AddRange_EmptyItems_NoChange()
    {
        List<int> list = new List<int> { 1, 2 };
        list.AddRange(new int[] { });
        Assert.Equal(2, list.Count);
        Assert.Equal(new[] { 1, 2 }, list);
    }

    [Fact]
    public void AddRange_NullItems_ThrowsArgumentNullException()
    {
        List<int> list = new List<int> { 1, 2 };
        Assert.Throws<ArgumentNullException>(() => list.AddRange(null!));
    }

    [Fact]
    public void Shift_NonEmptyList_RemovesFirstElement()
    {
        List<int> list = new List<int> { 1, 2, 3, 4 };
        list.Shift();
        Assert.Equal(3, list.Count);
        Assert.Equal(new[] { 2, 3, 4 }, list);
    }

    [Fact]
    public void Shift_SingleElementList_BecomesEmpty()
    {
        List<int> list = new List<int> { 42 };
        list.Shift();
        Assert.Empty(list);
    }

    [Fact]
    public void Shift_EmptyList_NoChange()
    {
        List<int> list = new List<int>();
        list.Shift();
        Assert.Empty(list);
    }

    [Fact]
    public void Slice_ValidRange_ReturnsSlice()
    {
        List<int> list = new List<int> { 1, 2, 3, 4, 5 };
        List<int> slice = list.Slice(1, 3);
        Assert.Equal(new[] { 2, 3, 4 }, slice);
    }

    [Fact]
    public void Slice_FromStart_ReturnsSlice()
    {
        List<int> list = new List<int> { 1, 2, 3, 4, 5 };
        List<int> slice = list.Slice(0, 2);
        Assert.Equal(new[] { 1, 2 }, slice);
    }

    [Fact]
    public void Slice_ZeroCount_ReturnsEmpty()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        List<int> slice = list.Slice(1, 0);
        Assert.Empty(slice);
    }

    [Fact]
    public void Slice_NegativeStart_ThrowsArgumentOutOfRangeException()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        Assert.Throws<ArgumentOutOfRangeException>(() => list.Slice(-1, 2));
    }

    [Fact]
    public void Slice_NegativeCount_ThrowsArgumentOutOfRangeException()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        Assert.Throws<ArgumentOutOfRangeException>(() => list.Slice(1, -2));
    }

    [Fact]
    public void Slice_StartPlusCountExceedsListCount_ThrowsArgumentOutOfRangeException()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        Assert.Throws<ArgumentException>(() => list.Slice(2, 5));
    }

    [Fact]
    public void Map_TransformsElements_ReturnsTransformedList()
    {
        List<int> list = new List<int> { 1, 2, 3, 4 };
        List<int> result = list.Map(x => x * 2);
        Assert.Equal(new[] { 2, 4, 6, 8 }, result);
    }

    [Fact]
    public void Map_ChangeType_ReturnsNewTypeList()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        List<string> result = list.Map(x => x.ToString());
        Assert.Equal(new[] { "1", "2", "3" }, result);
    }

    [Fact]
    public void Map_EmptyList_ReturnsEmptyList()
    {
        List<int> list = new List<int>();
        List<int> result = list.Map(x => x * 2);
        Assert.Empty(result);
    }

    [Fact]
    public void Map_NullMapFunction_ThrowsArgumentNullException()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        Assert.Throws<ArgumentNullException>(() => list.Map<int, int>(null!));
    }

    [Fact]
    public void FlatMap_FlattensNestedLists_ReturnsFlatList()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        List<int> result = list.FlatMap(x => new List<int> { x, x * 10 });
        Assert.Equal(new[] { 1, 10, 2, 20, 3, 30 }, result);
    }

    [Fact]
    public void FlatMap_EmptyInnerLists_ReturnsEmptyList()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        List<int> result = list.FlatMap(x => new List<int>());
        Assert.Empty(result);
    }

    [Fact]
    public void FlatMap_NullMapFunction_ThrowsArgumentNullException()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        Assert.Throws<ArgumentNullException>(() => list.FlatMap<int, int>(null!));
    }

    [Fact]
    public void Filter_FiltersElements_ReturnsMatchingElements()
    {
        List<int> list = new List<int> { 1, 2, 3, 4, 5, 6 };
        List<int> result = list.Filter(x => x % 2 == 0);
        Assert.Equal(new[] { 2, 4, 6 }, result);
    }

    [Fact]
    public void Filter_NoMatches_ReturnsEmptyList()
    {
        List<int> list = new List<int> { 1, 3, 5 };
        List<int> result = list.Filter(x => x % 2 == 0);
        Assert.Empty(result);
    }

    [Fact]
    public void Filter_AllMatch_ReturnsAllElements()
    {
        List<int> list = new List<int> { 2, 4, 6 };
        List<int> result = list.Filter(x => x % 2 == 0);
        Assert.Equal(list, result);
    }

    [Fact]
    public void Join_DefaultSeparator_ReturnsJoinedString()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        string result = list.Join();
        Assert.Equal("1, 2, 3", result);
    }

    [Fact]
    public void Join_CustomSeparator_ReturnsJoinedString()
    {
        List<string> list = new List<string> { "a", "b", "c" };
        string result = list.Join("-");
        Assert.Equal("a-b-c", result);
    }

    [Fact]
    public void Join_EmptyList_ReturnsEmptyString()
    {
        List<int> list = new List<int>();
        string result = list.Join();
        Assert.Equal(string.Empty, result);
    }

    [Fact]
    public void Batch_ListSmallerThanBatchSize_ReturnsSingleBatch()
    {
        List<int> list = new List<int> { 1, 2, 3 };
        var batches = list.Batch(5).ToList();
        Assert.Single(batches);
        Assert.Equal(list, batches[0]);
    }

    [Fact]
    public void Batch_ListLargerThanBatchSize_ReturnsMultipleBatches()
    {
        List<int> list = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
        var batches = list.Batch(3).ToList();
        Assert.Equal(3, batches.Count);
    }

    [Fact]
    public void BinarySearchFirst_FindsFirstOccurrence_ReturnsCorrectIndex()
    {
        List<int> list = new List<int> { 1, 3, 3, 3, 5, 7, 9 };
        int index = list.BinarySearchFirst(3, (item, value) => item.CompareTo(value));
        Assert.Equal(1, index);
    }

    [Fact]
    public void BinarySearchFirst_ValueNotFound_ReturnsInsertionPoint()
    {
        List<int> list = new List<int> { 1, 3, 5, 7, 9 };
        int index = list.BinarySearchFirst(4, (item, value) => item.CompareTo(value));
        Assert.Equal(2, index);
    }

    [Fact]
    public void BinarySearchFirst_EmptyList_ReturnsZero()
    {
        List<int> list = new List<int>();
        int index = list.BinarySearchFirst(5, (item, value) => item.CompareTo(value));
        Assert.Equal(0, index);
    }

    [Fact]
    public void Fill_AddsSpecifiedNumberOfElements()
    {
        List<int> list = new List<int>();
        list.Fill(42, 5);
        Assert.Equal(5, list.Count);
        Assert.All(list, item => Assert.Equal(42, item));
    }

    [Fact]
    public void Fill_ZeroCount_NoChange()
    {
        List<int> list = new List<int> { 1, 2 };
        list.Fill(99, 0);
        Assert.Equal(2, list.Count);
        Assert.Equal(new[] { 1, 2 }, list);
    }

    [Fact]
    public void Append_NullArray_ReturnsArrayWithSingleElement()
    {
        int[]? array = null;
        int[] result = array.Append(5);
        Assert.Single(result);
        Assert.Equal(5, result[0]);
    }

    [Fact]
    public void Append_EmptyArray_ReturnsArrayWithSingleElement()
    {
        int[] array = new int[] { };
        int[] result = array.Append(5);
        Assert.Single(result);
        Assert.Equal(5, result[0]);
    }

    [Fact]
    public void Append_NonEmptyArray_ReturnsArrayWithAppendedElement()
    {
        int[] array = new int[] { 1, 2, 3 };
        int[] result = array.Append(4);
        Assert.Equal(4, result.Length);
        Assert.Equal(new[] { 1, 2, 3, 4 }, result);
    }

    [Fact]
    public void Append_DoesNotModifyOriginalArray()
    {
        int[] array = new int[] { 1, 2, 3 };
        int[] result = array.Append(4);
        Assert.Equal(3, array.Length);
        Assert.Equal(new[] { 1, 2, 3 }, array);
    }
}
