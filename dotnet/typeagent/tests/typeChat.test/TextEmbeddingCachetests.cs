// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Vector;

namespace Microsoft.TypeChat.Tests;

public class TextEmbeddingCacheTests
{
    private const int DefaultCacheSize = 10;

    private static float[] CreateTestEmbedding(int seed = 0)
    {
        var random = new Random(seed);
        var embedding = new float[128];
        for (int i = 0; i < embedding.Length; i++)
        {
            embedding[i] = (float)random.NextDouble();
        }
        return embedding;
    }

    [Fact]
    public void Constructor_SetsMemCacheSize()
    {
        // Arrange & Act
        var cache = new TextEmbeddingCache(DefaultCacheSize);

        // Assert
        Assert.NotNull(cache);
        Assert.Null(cache.PersistentCache);
    }

    [Fact]
    public void Add_WithValidEmbedding_AddsToCache()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var key = "test_key";
        var embedding = CreateTestEmbedding(1);

        // Act
        cache.Add(key, embedding);

        // Assert
        var result = cache.Get(key);
        Assert.NotNull(result);
        Assert.Equal(embedding, result);
    }

    [Fact]
    public void Add_WithNullValue_DoesNotAddToCache()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var key = "test_key";

        // Act
        cache.Add(key, null);

        // Assert
        Assert.Null(cache.Get(key));
    }

    [Fact]
    public void Get_WithExistingKey_ReturnsEmbedding()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var key = "test_key";
        var embedding = CreateTestEmbedding(2);
        cache.Add(key, embedding);

        // Act
        var result = cache.Get(key);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(embedding, result);
    }

    [Fact]
    public void Get_WithNonExistingKey_ReturnsNull()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);

        // Act
        var result = cache.Get("nonexistent_key");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void TryGet_WithExistingKey_ReturnsTrueAndValue()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var key = "test_key";
        var embedding = CreateTestEmbedding(3);
        cache.Add(key, embedding);

        // Act
        var result = cache.TryGet(key, out var value);

        // Assert
        Assert.True(result);
        Assert.NotNull(value);
        Assert.Equal(embedding, value);
    }

    [Fact]
    public void TryGet_WithNonExistingKey_ReturnsFalse()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);

        // Act
        var result = cache.TryGet("nonexistent_key", out var value);

        // Assert
        Assert.False(result);
        Assert.Null(value);
    }

    [Fact]
    public void TryGet_WithPersistentCache_FallsBackToPersistentCache()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var key = "test_key";
        var embedding = CreateTestEmbedding(4);
        var persistentCache = new MockPersistentCache();
        persistentCache.Add(key, new Embedding(embedding));
        cache.PersistentCache = persistentCache;

        // Act
        var result = cache.TryGet(key, out var value);

        // Assert
        Assert.True(result);
        Assert.NotNull(value);
        Assert.Equal(embedding, value);
    }

    [Fact]
    public void TryGet_ChecksMemCacheBeforePersistentCache()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var key = "test_key";
        var memEmbedding = CreateTestEmbedding(5);
        var persistentEmbedding = CreateTestEmbedding(6);
        
        var persistentCache = new MockPersistentCache();
        persistentCache.Add(key, new Embedding(persistentEmbedding));
        cache.PersistentCache = persistentCache;
        
        cache.Add(key, memEmbedding);

        // Act
        var result = cache.TryGet(key, out var value);

        // Assert
        Assert.True(result);
        Assert.NotNull(value);
        Assert.Equal(memEmbedding, value); // Should get memory cache value
    }

    [Fact]
    public void Add_MultipleKeys_AllStored()
    {
        // Arrange
        var cache = new TextEmbeddingCache(3);
        var keys = new[] { "key1", "key2", "key3" };
        var embeddings = keys.Select((_, i) => CreateTestEmbedding(i + 10)).ToArray();

        // Act
        for (int i = 0; i < keys.Length; i++)
        {
            cache.Add(keys[i], embeddings[i]);
        }

        // Assert
        Assert.Equal(keys.Length, cache.Count);
        for (int i = 0; i < keys.Length; i++)
        {
            var result = cache.Get(keys[i]);
            Assert.NotNull(result);
            Assert.Equal(embeddings[i], result);
        }
    }

    [Fact]
    public void Add_ExceedingCacheSize_EvictsOldEntries()
    {
        // Arrange
        var cacheSize = 3;
        var cache = new TextEmbeddingCache(cacheSize);
        var keys = new[] { "key1", "key2", "key3", "key4", "key5" };

        // Act
        for (int i = 0; i < keys.Length; i++)
        {
            cache.Add(keys[i], CreateTestEmbedding(i + 20));
        }

        // Assert
        // Cache should have evicted old entries and count should reflect the LRU high watermark
        Assert.True(cache.Count <= cacheSize);
        
        // Most recent entries should be accessible
        Assert.NotNull(cache.Get(keys[^1])); // Last key should be present
    }

    [Fact]
    public void PersistentCache_CanBeSetAndRetrieved()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var persistentCache = new MockPersistentCache();

        // Act
        cache.PersistentCache = persistentCache;

        // Assert
        Assert.NotNull(cache.PersistentCache);
        Assert.Same(persistentCache, cache.PersistentCache);
    }

    [Fact]
    public void Count_ReflectsHighWatermark()
    {
        // Arrange
        var cache = new TextEmbeddingCache(3);

        // Act
        cache.Add("key1", CreateTestEmbedding(30));
        cache.Add("key2", CreateTestEmbedding(31));
        cache.Add("key3", CreateTestEmbedding(32));
        cache.Add("key4", CreateTestEmbedding(33));

        // Assert
        Assert.Equal(3, cache.Count);
    }

    [Fact]
    public void TryGet_WithPersistentCacheReturningNull_ReturnsFalse()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var persistentCache = new MockPersistentCache();
        cache.PersistentCache = persistentCache;

        // Act
        var result = cache.TryGet("nonexistent", out var value);

        // Assert
        Assert.False(result);
        Assert.Null(value);
    }

    [Fact]
    public void Add_SameKeyTwice_UpdatesValue()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var key = "test_key";
        var embedding1 = CreateTestEmbedding(40);
        var embedding2 = CreateTestEmbedding(41);

        // Act
        cache.Add(key, embedding1);
        cache.Add(key, embedding2);

        // Assert
        var result = cache.Get(key);
        Assert.NotNull(result);
        Assert.Equal(embedding2, result);
    }

    // Mock implementation of IReadOnlyCache for testing
    private class MockPersistentCache : IReadOnlyCache<string, Embedding>
    {
        private readonly Dictionary<string, Embedding> _storage = new();

        public void Add(string key, Embedding value)
        {
            _storage[key] = value;
        }

        public bool TryGet(string key, out Embedding value)
        {
            return _storage.TryGetValue(key, out value);
        }
    }
}
