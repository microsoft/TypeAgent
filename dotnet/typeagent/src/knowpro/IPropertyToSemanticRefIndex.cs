// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IPropertyToSemanticRefIndex
{
    Task<int> GetCountAsync(CancellationToken cancellationToken = default);

    Task<IList<string>> GetValuesAsync(CancellationToken cancellationToken = default);

    Task AddPropertyAync(string propertyName, string value, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellationToken = default);

    Task ClearAsync(CancellationToken cancellationToken = default);

    Task<IList<ScoredSemanticRefOrdinal>> LookupPropertyAsync(string propertyName, string value, CancellationToken cancellationToken = default);
}
