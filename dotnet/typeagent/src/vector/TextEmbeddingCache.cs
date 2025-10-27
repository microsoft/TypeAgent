// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

public class TextEmbeddingCache : ICache<string, float[]>
{
    private readonly LRUCache<string, float[]> _memCache;

    public TextEmbeddingCache(int memCacheSize)
    {
        _memCache = new LRUCache<string, float[]>(memCacheSize);
        PersistentCache = null;
    }

    public IReadOnlyCache<string, float[]>? PersistentCache { get; set; }

    public float[]? Get(string key) => _memCache.Get(key);

    public void Add(string key, float[]? value)
    {
        if (value is not null)
        {
            _memCache.Add(key, value);
        }
    }


    public bool TryGet(string key, out float[]? value)
    {
        if (!_memCache.TryGet(key, out value))
        {
            value = GetPersistent(key);
            return value is not null;
        }
        return true;
    }

    float[]? GetPersistent(string key)
    {
        return PersistentCache is not null && PersistentCache.TryGet(key, out var embedding) ? embedding : null;
    }
}
