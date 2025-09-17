// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IReadOnlyAsyncCollection<T, TOrdinal> : IAsyncEnumerable<T>
{
    Task<int> GetCountAsync();
    Task<T> GetAsync(TOrdinal ordinal);
    Task<IList<T>> GetAsync(IList<TOrdinal> ordinals);
    Task<IList<T>> GetSliceAsync(TOrdinal start, TOrdinal end);
}

public interface IAsyncCollection<T, TOrdinal> : IReadOnlyAsyncCollection<T, TOrdinal>
{
    bool IsPersistent { get; }

    Task AppendAsync(T item);
    Task AppendAsync(IList<T> items);
}