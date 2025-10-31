// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage;

/// <summary>
/// Null object implementation of IMessageTextIndex.
/// Provides a safe no-op index when message text indexing is disabled.
/// </summary>
public sealed class NullMessageTextIndex : IMessageTextIndex
{
#pragma warning disable CS0067
    public event Action<BatchProgress> OnIndexed;
#pragma warning restore CS0067

    public ValueTask AddMessageAsync(
        IMessage message,
        int messageOrdinal,
        CancellationToken cancellation = default
    ) => ValueTask.CompletedTask;

    public ValueTask AddMessagesAsync(
        IList<IMessage> messages,
        int messageOrdinal,
        CancellationToken cancellationToken = default
    ) => ValueTask.CompletedTask;

    public ValueTask ClearAsync(CancellationToken cancellationToken = default)
        => ValueTask.CompletedTask;

    public ValueTask<int> GetCountAsync(
        CancellationToken cancellationToken = default
    ) => ValueTask.FromResult(0);

    public ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesAsync(
        string messageText,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default
    ) => new ValueTask<IList<ScoredMessageOrdinal>>([]);

    public ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesInSubsetAsync(
        string messageText,
        IList<int> ordinalsToSearch,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default
    ) => new ValueTask<IList<ScoredMessageOrdinal>>([]);

    public ValueTask<int> GetMaxOrdinalAsync(CancellationToken cancellationToken = default)
        => ValueTask.FromResult(0);

}
