// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IPropertyToSemanticRefIndex
{
    Task<int> GetCountAsync();
    Task<string[]> GetValuesAsync();
    Task<string> AddPropertyAync(string propertyName, string value, ScoredSemanticRefOrdinal scoredOrdinal);
    Task ClearAsync();

    Task<ScoredSemanticRefOrdinal[]> LookupPropertyAsync(string propertyName, string value);

}

public static class PropertyToSemanticRefIndexEx
{
    public static Task<string> AddPropertyTermAsync(this IPropertyToSemanticRefIndex index, string propertyName, string value, SemanticRefOrdinal ordinal)
    {
        return index.AddPropertyAync(propertyName, value, ScoredSemanticRefOrdinal.New(ordinal));
    }
}
