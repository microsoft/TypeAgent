// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public interface IAsyncCollectionReader<T>
{
    ValueTask<T> GetAsync(int ordinal, CancellationToken cancellationToken = default);
    ValueTask<IList<T>> GetAsync(IList<int> ordinals, CancellationToken cancellationToken = default);
}

public interface IReadOnlyAsyncCollection<T> : IAsyncCollectionReader<T>, IAsyncEnumerable<T>
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);
    ValueTask<IList<T>> GetSliceAsync(int start, int end, CancellationToken cancellationToken = default);
}

public interface IAsyncCollection<T> : IReadOnlyAsyncCollection<T>
{
    bool IsPersistent { get; }

    ValueTask AppendAsync(T item, CancellationToken cancellationToken = default);
    ValueTask AppendAsync(IEnumerable<T> items, CancellationToken cancellationToken = default);
}

/// <summary>
/// Automatically injects a read cache in front of reading interfaces
/// </summary>
/// <typeparam name="TValue"></typeparam>
public class CachingCollectionReader<TValue> : IAsyncCollectionReader<TValue>
    where TValue : class
{
    IReadOnlyAsyncCollection<TValue> _collection;
    ICache<int, TValue> _cache;

    public CachingCollectionReader(IReadOnlyAsyncCollection<TValue> collection)
        : this(collection, new KeyValueCache<int, TValue>())
    {

    }

    public CachingCollectionReader(IReadOnlyAsyncCollection<TValue> collection, ICache<int, TValue> cache)
    {
        ArgumentVerify.ThrowIfNull(collection, nameof(collection));
        ArgumentVerify.ThrowIfNull(cache, nameof(cache));
        _collection = collection;
        _cache = cache;
    }

    public ValueTask<TValue> GetAsync(int ordinal, CancellationToken cancellationToken = default)
    {
        return _cache.GetOrLoadAsync(ordinal, _collection.GetAsync, cancellationToken);
    }

    public ValueTask<IList<TValue>> GetAsync(IList<int> ordinals, CancellationToken cancellationToken = default)
    {
        return _cache.GetOrLoadAsync(ordinals, _collection.GetAsync, cancellationToken);
    }
}
