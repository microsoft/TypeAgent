// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessageTextIndex
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask AddMessageAsync(IMessage message, CancellationToken cancellation = default);

    ValueTask AddMessagesAsync(IList<IMessage> messages, CancellationToken cancellationToken = default);

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
}
