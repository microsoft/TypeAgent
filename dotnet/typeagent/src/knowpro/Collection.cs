// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IReadOnlyAsyncCollection<T> : IAsyncEnumerable<T>
{
    Task<int> GetCountAsync();
    Task<T> GetAsync(int ordinal);
    Task<IList<T>> GetAsync(IList<int> ordinals);
    Task<IList<T>> GetSliceAsync(int start, int end);
}

public interface IAsyncCollection<T> : IReadOnlyAsyncCollection<T>
{
    bool IsPersistent { get; }

    Task AppendAsync(T item);
    Task AppendAsync(IEnumerable<T> items);
}
