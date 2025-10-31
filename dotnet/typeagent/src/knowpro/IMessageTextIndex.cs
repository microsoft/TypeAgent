// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessageTextIndex
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask AddMessageAsync(IMessage message, int messageOrdinal, CancellationToken cancellation = default);

    ValueTask AddMessagesAsync(
        IList<IMessage> messages,
        int baseMessageOrdinal,
        CancellationToken cancellationToken = default
    );

    ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesAsync(
        string messageText,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default);

    ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesInSubsetAsync(
        string messageText,
        IList<int> ordinalsToSearch,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default);

    ValueTask ClearAsync(CancellationToken cancellationToken = default);

    public event Action<BatchProgress> OnIndexed;
}
