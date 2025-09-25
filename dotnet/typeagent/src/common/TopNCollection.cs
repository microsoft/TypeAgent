// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public class TopNCollection<T>
{
    private List<ScoredItem<T>> _items;
    private int _count; // Actual count, since items always ha a
    private int _maxCount;

    public TopNCollection(int maxCount)
    {
        ArgumentVerify.ThrowIfLessThan(maxCount, 1, nameof(maxCount));
        _items = [];
        _count = 0;
        _maxCount = maxCount;
        _items.Add(new ScoredItem<T>() { Score = double.MinValue, Item = default });
    }

    public int Count => _items.Count;

    public ScoredItem<T> GetTop()
    {
        VerifyNotEmpty();
        return _items[1];
    }

    public void Reset()
    {
        _items.Clear();
        _items.Add(new ScoredItem<T>() { Score = double.MinValue, Item = default });
    }

    public void Add(T item, double score)
    {
        if (_count == _maxCount)
        {
            if (score < _items[1].Score)
            {
                return;
            }
            RemoveTop();
            _count++;
            _items[_count] = new ScoredItem<T>(item, score);
        }
        else
        {
            _count++;
            _items.Add(new ScoredItem<T>(item, score));
        }
        UpHeap(_count);
    }

    private ScoredItem<T> RemoveTop()
    {
        VerifyNotEmpty();

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

    private void VerifyNotEmpty()
    {
        if (_count == 0)
        {
            throw new InvalidOperationException("TopNCollection is empty");
        }
    }
}
