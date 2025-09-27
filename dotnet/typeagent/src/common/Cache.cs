// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public interface ICache<TKey, TValue>
{
    bool TryGet(TKey key, out TValue value);

    bool Contains(TKey key);

    void Add(TKey key, TValue value);
}

public class LRUCache<TKey, TValue> : ICache<TKey, TValue>
{
    private readonly Dictionary<TKey, LinkedListNode<KeyValuePair<TKey, TValue>>> _index;
    private readonly LinkedList<KeyValuePair<TKey, TValue>> _itemList;
    private readonly int _highWatermark;
    private readonly int _lowWatermark;

    public LRUCache(int maxEntries, IEqualityComparer<TKey> comparer = null)
        : this(maxEntries - 1, maxEntries, comparer)
    {
    }

    public LRUCache(int lowWatermark, int highWatermark, IEqualityComparer<TKey> comparer = null)
    {
        ArgumentVerify.ThrowIfLessThan(lowWatermark, 0, nameof(lowWatermark));
        ArgumentVerify.ThrowIfLessThan(highWatermark, lowWatermark, nameof(highWatermark));

        _lowWatermark = lowWatermark;
        _highWatermark = highWatermark;
        _index = comparer is not null ?
                new Dictionary<TKey, LinkedListNode<KeyValuePair<TKey, TValue>>>(comparer) :
                [];

        _itemList = new LinkedList<KeyValuePair<TKey, TValue>>();
    }

    public int Count => _itemList.Count;
    public int HighWatermark => _highWatermark;
    public int LowWatermark => _lowWatermark;

    public event Action<KeyValuePair<TKey, TValue>> Purged;

    public TValue this[TKey key] => TryGet(key, out var value) ? value : throw new KeyNotFoundException();

    public bool TryGet(TKey key, out TValue value)
    {
        value = default;
        if (_index.TryGetValue(key, out LinkedListNode<KeyValuePair<TKey, TValue>> item))
        {
            MakeMRU(item);
            value = item.Value.Value;
            return true;
        }

        return false;
    }

    public bool Contains(TKey key)
    {
        return TryGet(key, out _);
    }

    public void Add(TKey key, TValue value)
    {
        Add(new KeyValuePair<TKey, TValue>(key, value));
    }

    public void Add(KeyValuePair<TKey, TValue> kvPair)
    {
        LinkedListNode<KeyValuePair<TKey, TValue>> newNode = null;
        if (_itemList.Count == _highWatermark)
        {
            // Remove old items from the cache. 
            // Reuse the last node... keep GC happier
            newNode = Shrink();
        }

        if (newNode is null)
        {
            newNode = new LinkedListNode<KeyValuePair<TKey, TValue>>(kvPair);
        }
        else
        {
            newNode.Value = kvPair;
        }

        _index[kvPair.Key] = newNode;
        _itemList.AddFirst(newNode);
    }

    public void Put(TKey key, TValue value)
    {
        if (_index.TryGetValue(key, out LinkedListNode<KeyValuePair<TKey, TValue>> item))
        {
            MakeMRU(item);
            item.Value = new KeyValuePair<TKey, TValue>(key, value);
        }
        else
        {
            Add(key, value);
        }
    }

    public void Remove(TKey key)
    {
        LinkedListNode<KeyValuePair<TKey, TValue>> node = _index[key];
        _index.Remove(key);
        _itemList.Remove(node);
    }

    public void Trim()
    {
        Shrink();
    }

    public void Clear()
    {
        _index.Clear();
        _itemList.Clear();
    }

    void MakeMRU(LinkedListNode<KeyValuePair<TKey, TValue>> node)
    {
        _itemList.Remove(node);
        _itemList.AddFirst(node);
    }

    LinkedListNode<KeyValuePair<TKey, TValue>> Shrink()
    {
        LinkedListNode<KeyValuePair<TKey, TValue>> lastNode = null;
        while (_itemList.Count > _lowWatermark)
        {
            lastNode = _itemList.Last;
            KeyValuePair<TKey, TValue> last = lastNode.Value;
            _itemList.RemoveLast();
            _index.Remove(last.Key);
            Purged?.Invoke(last);
        }

        return lastNode;
    }
}

public class Cache<TKey, TValue> : ICache<TKey, TValue>
{
    Dictionary<TKey, TValue> _items;

    public Cache(IEqualityComparer<TKey> comparer = null)
    {
        _items = [];
    }

    public void Add(TKey key, TValue value)
    {
        _items[key] = value;
    }

    public bool Contains(TKey key) => _items.ContainsKey(key);

    public bool TryGet(TKey key, out TValue value) => _items.TryGetValue(key, out value);
}

public static class CacheExtensions
{
    public static async Task<IList<TValue>> GetFromCachedOrFetchAsync<TKey, TValue> (
        this ICache<TKey, TValue> cache,
        IList<TKey> keys,
        Func<IList<TKey>, Task<IList<TValue>>> resolver
    )
        where TValue : class
    {
        ArgumentVerify.ThrowIfNullOrEmpty(keys, nameof(keys));
        ArgumentVerify.ThrowIfNull(resolver, nameof(resolver));

        (var values, var pendingKeys) = cache.ResolveKeys(keys);
        if (pendingKeys.IsNullOrEmpty())
        {
            return values;
        }
        IList<TValue> pendingValues = await resolver(pendingKeys);
        if (values.Count != pendingKeys.Count)
        {
            throw new TypeAgentException("Resolver returned incorrect number of values");
        }
        // Merge the batch into results
        cache.MergePendingResults(keys, values, pendingValues);
        return values;
    }

    private static (IList<TValue> values, IList<TKey>? pending) ResolveKeys<TKey, TValue>(
        this ICache<TKey, TValue> cache,
        IList<TKey> keys
    )
    {
        //
        // Fill items from cache
        //
        List<TValue> values = new List<TValue>(keys.Count);
        List<TKey> pending = null;
        for (int i = 0; i < keys.Count; ++i)
        {
            TKey key = keys[i];
            if (cache.TryGet(key, out var value))
            {
                values[i] = value;
            }
            else
            {
                pending ??= [];
                pending.Add(key);
            }
        }
        return (values, keys);
    }

    private static void MergePendingResults<TKey, TValue>(
        this ICache<TKey, TValue> cache,
        IList<TKey> keys,
        IList<TValue> values,
        IList<TValue> pendingValues
    )
        where TValue : class
    {
        // Merge the batch into results
        int iPending = 0;
        for (int i = 0; i < values.Count; ++i)
        {
            if (values[i] is null)
            {
                values[i] = pendingValues[iPending++];
                cache.Add(keys[i], values[i]);
            }
        }
    }
}
