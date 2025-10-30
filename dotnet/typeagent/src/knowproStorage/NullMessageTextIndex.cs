// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage;

/// <summary>
/// Null object implementation of IMessageTextIndex.
/// Provides a safe no-op index when message text indexing is disabled.
/// </summary>
public sealed class NullMessageTextIndex : IMessageTextIndex
{
    public ValueTask AddMessageAsync(
        IMessage message,
        CancellationToken cancellation = default
    ) => ValueTask.CompletedTask;

    public ValueTask AddMessagesAsync(
        IList<IMessage> messages,
        CancellationToken cancellationToken = default
    ) => ValueTask.CompletedTask;

    public ValueTask<int> GetCountAsync(
        CancellationToken cancellationToken = default
    ) => ValueTask.FromResult(0);

    public ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesAsync(
        string messageText,
        int? maxMatches = null,
        double? thresholdScore = null,
        CancellationToken cancellationToken = default
    ) => new ValueTask<IList<ScoredMessageOrdinal>>([]);

    public ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesInSubsetAsync(
        string messageText,
        IEnumerable<int> ordinalsToSearch,
        int? maxMatches = null,
        double? thresholdScore = null,
        CancellationToken cancellationToken = default
    ) => new ValueTask<IList<ScoredMessageOrdinal>>([]);
}
