// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public interface ITopNCollection<T>
{
    int Count { get; }

    void Add(T item, double score);
    void Add(IEnumerable<Scored<T>> items);
    List<Scored<T>> ByRankAndClear();
}

public static class TopNCollection
{
    public static ITopNCollection<T> Create<T>(int maxMatches)
    {
        return maxMatches > 0
            ? new TopNCollection<T>(maxMatches)
            : new CollectAllCollection<T>();
    }
}

public class TopNCollection<T> : ITopNCollection<T>
{
    private List<Scored<T>>? _items;
    private int _count; // Actual count, since items always ha a
    private int _maxCount;

    public TopNCollection(int maxCount, List<Scored<T>> buffer = null)
    {
        ArgumentVerify.ThrowIfLessThan(maxCount, 1, nameof(maxCount));

        _maxCount = maxCount;
        _items = buffer;
        _items?.Clear();
        _count = 0;
    }

    public int Count => _count;

    public Scored<T> GetTop()
    {
        VerifyNotEmpty();
        return _items[1];
    }

    public void Clear()
    {
        _items?.Clear();
        _count = 0;
    }

    public void Add(T item, double score)
    {
        EnsureInitialized();
        if (_count == _maxCount)
        {
            if (score < _items[1].Score)
            {
                return;
            }
            RemoveTop();
            _count++;
            _items[_count] = new Scored<T>(item, score);
        }
        else
        {
            _count++;
            _items.Add(new Scored<T>(item, score));
        }
        UpHeap(_count);
    }

    public void Add(IEnumerable<Scored<T>> items)
    {
        ArgumentVerify.ThrowIfNull(items, nameof(items));
        foreach(var item in items)
        {
            Add(item.Item, item.Score);
        }
    }

    /// <summary>
    /// Sorts the colletion by Rank
    /// Returns the sorted buffer, and clears the collection
    /// </summary>
    /// <returns></returns>
    public List<Scored<T>> ByRankAndClear()
    {
        if (_count == 0)
        {
            return [];
        }

        SortDescending();
        _items.Shift();

        var retVal = _items;
        _items = null;
        return retVal;
    }

    // Heap sort in place
    private void SortDescending()
    {
        var count = this._count;
        var i = count;
        while (this._count > 0)
        {
            // this de-queues the item with the current LOWEST relevancy
            // We take that and place it at the 'back' of the array - thus inverting it
            var item = RemoveTop();
            _items[i--] = item;
        }
        _count = count;
    }

    private Scored<T> RemoveTop()
    {
        // At the top
        var item = _items[1];
        _items[1] = _items[_count];
        _count--;
        DownHeap(1);

        return item;
    }

    private void UpHeap(int startAt)
    {
        var i = startAt;
        var item = _items[i];
        var parent = i >> 1;
        // As long as child has a lower score than the parent, keep moving the child up
        while (parent > 0 && _items[parent].Score > item.Score)
        {
            this._items[i] = this._items[parent];
            i = parent;
            parent = i >> 1;
        }
        // Found our slot
        this._items[i] = item;
    }

    private void DownHeap(int startAt)
    {
        var i = startAt;
        var maxParent = _count >> 1;
        var item = _items[i];
        while (i <= maxParent)
        {
            var iChild = i + i;
            var childScore = _items[iChild].Score;
            // Exchange the item with the smaller of its two children - if one is smaller, i.e.
            // First, find the smaller child
            if (iChild < _count && childScore > _items[iChild + 1].Score)
            {
                iChild++;
                childScore = _items[iChild].Score;
            }
            if (item.Score <= childScore)
            {
                // Heap condition is satisfied. Parent <= both its children
                break;
            }
            // Else, swap parent with the smallest child
            _items[i] = _items[iChild];
            i = iChild;
        }
        _items[i] = item;
    }

    private void EnsureInitialized()
    {
        if (_items is null)
        {
            _items = [];
            _items.Add(new Scored<T>() { Score = double.MinValue, Item = default });
        }
    }

    private void VerifyNotEmpty()
    {
        if (_items is null || _count == 0)
        {
            throw new TypeAgentException("TopNCollection is empty");
        }
    }
}

public class CollectAllCollection<T> : ITopNCollection<T>
{
    List<Scored<T>>? _items = null;

    public CollectAllCollection()
    {
    }

    public int Count => _items is not null
            ? _items.Count :
            0;

    public void Add(T item, double score)
    {
        _items ??= [];
        _items.Add(new Scored<T>(item, score));
    }

    public void Add(IEnumerable<Scored<T>> items)
    {
        _items ??= [];
        _items.AddRange(items);
    }

    public List<Scored<T>> ByRankAndClear()
    {
        var results = _items ?? [];
        results.Sort();
        _items = null;
        return results;
    }
}
