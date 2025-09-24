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

public static class PropertyToSemanticRefIndexEx
{
    public static Task AddPropertyTermAsync(this IPropertyToSemanticRefIndex index, string propertyName, string value, int semanticRefOrdinal, CancellationToken cancellationToken = default)
    {
        return index.AddPropertyAync(propertyName, value, ScoredSemanticRefOrdinal.New(semanticRefOrdinal), cancellationToken);
    }
}
