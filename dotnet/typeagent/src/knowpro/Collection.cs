// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IReadOnlyAsyncCollection<T> : IAsyncEnumerable<T>
{
    Task<int> GetCountAsync(CancellationToken cancellationToken = default);
    Task<T> GetAsync(int ordinal, CancellationToken cancellationToken = default);
    Task<IList<T>> GetAsync(IList<int> ordinals, CancellationToken cancellationToken = default);
    Task<IList<T>> GetSliceAsync(int start, int end, CancellationToken cancellationToken = default);
}

public interface IAsyncCollection<T> : IReadOnlyAsyncCollection<T>
{
    bool IsPersistent { get; }

    Task AppendAsync(T item, CancellationToken cancellationToken = default);
    Task AppendAsync(IEnumerable<T> items, CancellationToken cancellationToken = default);
}
