// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading;

namespace TypeAgent.Common;

public interface IReadOnlyCache<TKey, TValue>
{
    bool TryGet(TKey key, out TValue? value);
}

public interface ICache<TKey, TValue> : IReadOnlyCache<TKey, TValue>
{
    void Add(TKey key, TValue value);
}

/// <summary>
/// Cache that implements LRU Cache policy
/// </summary>
/// <typeparam name="TKey"></typeparam>
/// <typeparam name="TValue"></typeparam>
public class LRUCache<TKey, TValue> : ICache<TKey, TValue>
{
    private readonly Dictionary<TKey, LinkedListNode<KeyValuePair<TKey, TValue>>> _index;
    private readonly LinkedList<KeyValuePair<TKey, TValue>> _itemList;
    private int _highWatermark;
    private int _lowWatermark;

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

    public TValue? Get(TKey key)
    {
        return TryGet(key, out var value) ? value : default;
    }

    public bool TryGet(TKey key, out TValue? value)
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
        return _index.ContainsKey(key);
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

    public void SetCount(int maxEntries)
    {
        _highWatermark = maxEntries;
        _lowWatermark = maxEntries - 1;
        Trim();
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

/// <summary>
/// Vanilla cache with no cache replacement policy
/// </summary>
/// <typeparam name="TKey"></typeparam>
/// <typeparam name="TValue"></typeparam>
public class KeyValueCache<TKey, TValue> : Dictionary<TKey, TValue>, ICache<TKey, TValue>
{
    public KeyValueCache(IEqualityComparer<TKey> comparer = null)
        : base(comparer)
    {
    }

    public bool Contains(TKey key) => base.ContainsKey(key);

    public bool TryGet(TKey key, out TValue value) => base.TryGetValue(key, out value);

    public new void Add(TKey key, TValue value)
    {
        TryAdd(key, value);
    }
}

public static class Cache
{
    /// <summary>
    /// Create a new cache.
    /// If maxCacheSize provided, creates an LRUCache
    /// Else creates a KeyValueCache
    /// </summary>
    /// <typeparam name="TKey"></typeparam>
    /// <typeparam name="TValue"></typeparam>
    /// <param name="maxCacheSize"></param>
    /// <returns></returns>
    public static ICache<TKey, TValue> Create<TKey, TValue>(int? maxCacheSize = null)
    {
        return maxCacheSize is not null
            ? new LRUCache<TKey, TValue>(maxCacheSize.Value)
            : new KeyValueCache<TKey, TValue>();
    }

    // If item is found in cache, return it, else load
    public static async ValueTask<TValue> GetOrLoadAsync<TKey, TValue>(
        this ICache<TKey, TValue> cache,
        TKey key,
        Func<TKey, CancellationToken, ValueTask<TValue>> loader,
        CancellationToken cancellationToken = default
    )
        where TValue : class
    {
        if (!cache.TryGet(key, out TValue value))
        {
            value = await loader(key, cancellationToken).ConfigureAwait(false);
            cache.Add(key, value);
        }
        return value;
    }

    // Finds keys that don't have available values in the cache and loads only their values
    // Keys that have values present in the cache are returned as i
    public static async ValueTask<IList<TValue>> GetOrLoadAsync<TKey, TValue>(
        this ICache<TKey, TValue> cache,
        IList<TKey> keys,
        Func<IList<TKey>, CancellationToken, ValueTask<IList<TValue>>> loader,
        CancellationToken cancellationToken = default
    )
        where TValue : class
    {
        ArgumentVerify.ThrowIfNullOrEmpty(keys, nameof(keys));
        ArgumentVerify.ThrowIfNull(loader, nameof(loader));

        (var values, var pendingKeys) = cache.ResolveKeys(keys);
        if (pendingKeys.IsNullOrEmpty())
        {
            return values;
        }
        IList<TValue> pendingValues = await loader(pendingKeys, cancellationToken).ConfigureAwait(false);
        if (pendingValues.Count != pendingKeys.Count)
        {
            throw new TypeAgentException($"Cache Resolver: Expected {pendingKeys.Count}, Got: {pendingValues.Count}");
        }
        // Merge the batch into results
        cache.MergePendingResults(keys, values, pendingValues);
        return values;
    }

    // Fill available items from the cache, returning a list of pending keys to retrieve
    private static (TValue[] values, List<TKey>? pending) ResolveKeys<TKey, TValue>(
        this ICache<TKey, TValue> cache,
        IList<TKey> keys
    )
    {
        //
        // Fill items from cache
        //
        TValue[] values = new TValue[keys.Count];
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
                values[i] = default;
                pending ??= [];
                pending.Add(key);
            }
        }
        return (values, pending);
    }

    private static void MergePendingResults<TKey, TValue>(
        this ICache<TKey, TValue> cache,
        IList<TKey> keys,
        TValue[] values,
        IList<TValue> pendingValues
    )
        where TValue : class
    {
        // Merge the batch into results
        int iPending = 0;
        for (int i = 0; i < values.Length; ++i)
        {
            if (values[i] is null)
            {
                values[i] = pendingValues[iPending++];
                // Also update cache
                cache.Add(keys[i], values[i]);
            }
        }
    }
}
