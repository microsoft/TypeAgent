// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IPropertyToSemanticRefIndex
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask<IList<string>> GetValuesAsync(CancellationToken cancellationToken = default);

    ValueTask AddPropertyAsync(string propertyName, string value, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellationToken = default);

    ValueTask<IList<ScoredSemanticRefOrdinal>> LookupPropertyAsync(string propertyName, string value, CancellationToken cancellationToken = default);

    ValueTask ClearAsync(CancellationToken cancellationToken = default);
}
