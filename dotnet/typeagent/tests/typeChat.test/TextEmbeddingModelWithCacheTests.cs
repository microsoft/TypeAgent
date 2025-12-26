// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.AIClient;
using TypeAgent.Vector;

namespace Microsoft.TypeChat.Tests;

public class TextEmbeddingModelWithCacheTests
{
    private const int DefaultCacheSize = 10;
    private const int DefaultMaxBatchSize = 16;

    public TextEmbeddingModelWithCacheTests()
    {
        TestHelpers.LoadDotEnvOrSkipTest();
    }

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

    private class MockTextEmbeddingModel : ITextEmbeddingModel
    {
        private readonly Dictionary<string, float[]> _embeddings = [];
        private int _generateCallCount = 0;
        private int _generateBatchCallCount = 0;

        public int MaxBatchSize { get; }

        public int GenerateCallCount => _generateCallCount;
        public int GenerateBatchCallCount => _generateBatchCallCount;

        public MockTextEmbeddingModel(int maxBatchSize = DefaultMaxBatchSize)
        {
            MaxBatchSize = maxBatchSize;
        }

        public Task<float[]> GenerateAsync(string text, CancellationToken cancellationToken)
        {
            _generateCallCount++;
            
            if (!_embeddings.TryGetValue(text, out var embedding))
            {
                embedding = CreateTestEmbedding(text.GetHashCode());
                _embeddings[text] = embedding;
            }
            
            return Task.FromResult(embedding);
        }

        public Task<IList<float[]>> GenerateAsync(IList<string> texts, CancellationToken cancellationToken)
        {
            _generateBatchCallCount++;
            
            var results = new List<float[]>();
            foreach (var text in texts)
            {
                if (!_embeddings.TryGetValue(text, out var embedding))
                {
                    embedding = CreateTestEmbedding(text.GetHashCode());
                    _embeddings[text] = embedding;
                }
                results.Add(embedding);
            }
            
            return Task.FromResult<IList<float[]>>(results);
        }

        public void Reset()
        {
            _generateCallCount = 0;
            _generateBatchCallCount = 0;
        }
    }

    [Fact]
    public void Constructor_WithCacheSize_CreatesInstance()
    {
        // Arrange & Act
        var model = new TextEmbeddingModelWithCache(DefaultCacheSize);

        // Assert
        Assert.NotNull(model);
        Assert.NotNull(model.InnerModel);
        Assert.NotNull(model.Cache);
        Assert.True(model.CacheEnabled);
    }

    [Fact]
    public void Constructor_WithModelAndCacheSize_CreatesInstance()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();

        // Act
        var model = new TextEmbeddingModelWithCache(innerModel, DefaultCacheSize);

        // Assert
        Assert.NotNull(model);
        Assert.NotNull(model.InnerModel);
        Assert.NotNull(model.Cache);
        Assert.True(model.CacheEnabled);
    }

    [Fact]
    public void Constructor_WithModelAndCache_CreatesInstance()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);

        // Act
        var model = new TextEmbeddingModelWithCache(innerModel, cache);

        // Assert
        Assert.NotNull(model);
        Assert.Same(innerModel, model.InnerModel);
        Assert.Same(cache, model.Cache);
        Assert.True(model.CacheEnabled);
    }

    [Fact]
    public void Constructor_WithNullInnerModel_ThrowsArgumentNullException()
    {
        // Arrange
        var cache = new TextEmbeddingCache(DefaultCacheSize);

        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new TextEmbeddingModelWithCache(null!, cache));
    }

    [Fact]
    public void Constructor_WithNullCache_ThrowsArgumentNullException()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();

        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new TextEmbeddingModelWithCache(innerModel, null!));
    }

    [Fact]
    public void MaxBatchSize_ReturnsInnerModelMaxBatchSize()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel(32);
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);

        // Act
        var maxBatchSize = model.MaxBatchSize;

        // Assert
        Assert.Equal(32, maxBatchSize);
    }

    [Fact]
    public void CacheEnabled_CanBeSetAndRetrieved()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);

        // Act
        model.CacheEnabled = false;

        // Assert
        Assert.False(model.CacheEnabled);
    }

    [Fact]
    public async Task GenerateAsync_SingleText_CallsInnerModelAndCachesResult()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var text = "test text";

        // Act
        var result = await model.GenerateAsync(text, CancellationToken.None);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(1, innerModel.GenerateCallCount);
        
        // Verify result is cached
        var cachedResult = cache.Get(text);
        Assert.NotNull(cachedResult);
        Assert.Equal(result, cachedResult);
    }

    [Fact]
    public async Task GenerateAsync_SingleText_UsesCacheOnSecondCall()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var text = "test text";

        // Act
        var result1 = await model.GenerateAsync(text, CancellationToken.None);
        innerModel.Reset();
        var result2 = await model.GenerateAsync(text, CancellationToken.None);

        // Assert
        Assert.Equal(result1, result2);
        Assert.Equal(0, innerModel.GenerateCallCount);
    }

    [Fact]
    public async Task GenerateAsync_SingleText_WithCacheDisabled_BypassesCache()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var text = "test text";
        model.CacheEnabled = false;

        // Act
        var result = await model.GenerateAsync(text, CancellationToken.None);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(1, innerModel.GenerateCallCount);
        
        // Verify result is NOT cached
        var cachedResult = cache.Get(text);
        Assert.Null(cachedResult);
    }

    [Fact]
    public async Task GenerateAsync_MultipleTexts_CallsInnerModelAndCachesResults()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var texts = new List<string> { "text1", "text2", "text3" };

        // Act
        var results = await model.GenerateAsync(texts, CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        Assert.Equal(3, results.Count);
        Assert.Equal(1, innerModel.GenerateBatchCallCount);
        
        // Verify all results are cached
        foreach (var text in texts)
        {
            var cachedResult = cache.Get(text);
            Assert.NotNull(cachedResult);
        }
    }

    [Fact]
    public async Task GenerateAsync_MultipleTexts_UsesCacheForCachedTexts()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var texts1 = new List<string> { "text1", "text2" };
        var texts2 = new List<string> { "text2", "text3" }; // text2 is already cached

        // Act
        await model.GenerateAsync(texts1, CancellationToken.None);
        innerModel.Reset();
        var results = await model.GenerateAsync(texts2, CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        Assert.Equal(2, results.Count);
        
        // Only text3 should cause a call to inner model
        Assert.Equal(1, innerModel.GenerateBatchCallCount);
    }

    [Fact]
    public async Task GenerateAsync_MultipleTexts_WithCacheDisabled_BypassesCache()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var texts = new List<string> { "text1", "text2", "text3" };
        model.CacheEnabled = false;

        // Act
        var results = await model.GenerateAsync(texts, CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        Assert.Equal(3, results.Count);
        Assert.Equal(1, innerModel.GenerateBatchCallCount);
        
        // Verify results are NOT cached
        foreach (var text in texts)
        {
            var cachedResult = cache.Get(text);
            Assert.Null(cachedResult);
        }
    }

    [Fact]
    public async Task GenerateAsync_MultipleTexts_AllCached_DoesNotCallInnerModel()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var texts = new List<string> { "text1", "text2", "text3" };

        // Pre-populate cache
        await model.GenerateAsync(texts, CancellationToken.None);
        innerModel.Reset();

        // Act
        var results = await model.GenerateAsync(texts, CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        Assert.Equal(3, results.Count);
        Assert.Equal(0, innerModel.GenerateBatchCallCount);
    }

    [Fact]
    public async Task GenerateAsync_MixedCachedAndUncached_OptimizesInnerModelCalls()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        
        // Pre-cache some texts
        await model.GenerateAsync(new List<string> { "text1", "text2" }, CancellationToken.None);
        innerModel.Reset();
        
        var mixedTexts = new List<string> { "text1", "text3", "text2", "text4" };

        // Act
        var results = await model.GenerateAsync(mixedTexts, CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        Assert.Equal(4, results.Count);
        
        // Should only call inner model for text3 and text4
        Assert.Equal(1, innerModel.GenerateBatchCallCount);
    }

    [Fact]
    public async Task GenerateAsync_WithCancellationToken_PassesToInnerModel()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var cts = new CancellationTokenSource();
        var text = "test text";

        // Act
        var result = await model.GenerateAsync(text, cts.Token);

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public async Task GenerateAsync_CacheToggle_WorksCorrectly()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var text = "test text";

        // Act & Assert - With cache enabled
        var result1 = await model.GenerateAsync(text, CancellationToken.None);
        Assert.Equal(1, innerModel.GenerateCallCount);

        // Second call should use cache
        innerModel.Reset();
        var result2 = await model.GenerateAsync(text, CancellationToken.None);
        Assert.Equal(0, innerModel.GenerateCallCount);
        Assert.Equal(result1, result2);

        // Disable cache and call again
        model.CacheEnabled = false;
        innerModel.Reset();
        var result3 = await model.GenerateAsync(text, CancellationToken.None);
        Assert.Equal(1, innerModel.GenerateCallCount);

        // Enable cache again
        model.CacheEnabled = true;
        innerModel.Reset();
        var result4 = await model.GenerateAsync(text, CancellationToken.None);
        Assert.Equal(0, innerModel.GenerateCallCount); // Should use cache
    }

    [Fact]
    public async Task GenerateAsync_SameTextMultipleTimes_UsesCache()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(DefaultCacheSize);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var text = "test text";

        // Act
        var result1 = await model.GenerateAsync(text, CancellationToken.None);
        var result2 = await model.GenerateAsync(text, CancellationToken.None);
        var result3 = await model.GenerateAsync(text, CancellationToken.None);

        // Assert
        Assert.Equal(result1, result2);
        Assert.Equal(result2, result3);
        Assert.Equal(1, innerModel.GenerateCallCount); // Only called once
    }

    [Fact]
    public async Task GenerateAsync_LargeNumberOfTexts_HandlesCachingCorrectly()
    {
        // Arrange
        var innerModel = new MockTextEmbeddingModel();
        var cache = new TextEmbeddingCache(100);
        var model = new TextEmbeddingModelWithCache(innerModel, cache);
        var texts = Enumerable.Range(0, 50).Select(i => $"text{i}").ToList();

        // Act
        var results1 = await model.GenerateAsync(texts, CancellationToken.None);
        innerModel.Reset();
        var results2 = await model.GenerateAsync(texts, CancellationToken.None);

        // Assert
        Assert.Equal(50, results1.Count);
        Assert.Equal(50, results2.Count);
        Assert.Equal(0, innerModel.GenerateBatchCallCount); // All cached
    }
}
