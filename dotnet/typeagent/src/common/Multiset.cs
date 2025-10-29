// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

/// <summary>
/// A dictionary that permits DUPLICATES.
/// </summary>
public class Multiset<TKey, TValue> : Dictionary<TKey, List<TValue>>, IEnumerable<TValue>
{
    Func<List<TValue>> _allocator = NewList;

    public Multiset(IEnumerable<KeyValuePair<TKey, TValue>>? values = null)
        : base()
    {
        if (values is not null)
        {
            Add(values);
        }
    }

    public Multiset(IEqualityComparer<TKey> comparer)
        : base(comparer)
    {
    }

    public Multiset(
        int capacity,
        IEqualityComparer<TKey> comparer,
        Func<List<TValue>>? allocator
        )
        : base(capacity, comparer)
    {
        if (allocator is not null)
        {
            this._allocator = allocator;
        }
    }

    public List<TValue>? Get(TKey key)
    {
        return TryGetValue(key, out var list) ? list : null;
    }

    public List<TValue> GetOrAdd(TKey key)
    {
        if (TryGetValue(key, out var list))
        {
            return list;
        }
        list = _allocator();
        this[key] = list;
        return list;
    }

    public void Add(TKey key, TValue value)
    {
        var valueList = GetOrAdd(key);
        valueList.Add(value);
    }

    public void Add(KeyValuePair<TKey, TValue> kv)
    {
        Add(kv.Key, kv.Value);
    }

    public void Add(IEnumerable<KeyValuePair<TKey, TValue>> keyValues)
    {
        ArgumentVerify.ThrowIfNull(keyValues, nameof(keyValues));
        foreach (KeyValuePair<TKey, TValue> kv in keyValues)
        {
            Add(kv.Key, kv.Value);
        }
    }

    public void Remove(TKey key, TValue value)
    {
        if (TryGetValue(key, out var valueList))
        {
            valueList.Remove(value);
        }
    }

    public void ForEachList(Action<List<TValue>> action)
    {
        ArgumentVerify.ThrowIfNull(action, nameof(action));

        foreach (List<TValue> list in Values)
        {
            action(list);
        }
    }

    public void ForEach(Action<TValue> action)
    {
        ArgumentVerify.ThrowIfNull(action, nameof(action));
        foreach (var value in (IEnumerable<TValue>)this)
        {
            action(value);
        }
    }

    public new void TrimExcess()
    {
        ForEachList((l) => l.TrimExcess());
        base.TrimExcess();
    }

    // Override to use pools etc.
    //
    static List<TValue> NewList() => [];

    IEnumerator<TValue> IEnumerable<TValue>.GetEnumerator()
    {
        foreach (var list in Values)
        {
            foreach (var value in list)
            {
                yield return value;
            }
        }
    }
}

