// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessageTextIndex
{
    ValueTask AddMessagesAsync(IList<IMessage> messages, CancellationToken cancellationToken = default);

    ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesAsync(
        string messageText,
        int? maxMatches = null,
        double? thresholdScore = null,
        CancellationToken cancellationToken = default);

    ValueTask<IList<ScoredMessageOrdinal>> LookupMessagesInSubsetAsync(
        string messageText,
        IEnumerable<int> ordinalsToSearch,
        int? maxMatches = null,
        double? thresholdScore = null,
        CancellationToken cancellationToken = default);
}
