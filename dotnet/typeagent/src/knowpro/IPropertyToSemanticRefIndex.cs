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
    public static Task AddPropertyAsync(this IPropertyToSemanticRefIndex propertyIndex, string propertyName, string value, int semanticRefOrdinal, CancellationToken cancellationToken = default)
    {
        return propertyIndex.AddPropertyAync(propertyName, value, ScoredSemanticRefOrdinal.New(semanticRefOrdinal), cancellationToken);
    }

    public static async Task AddEntityProperties(
        this IPropertyToSemanticRefIndex propertyIndex,
        ConcreteEntity entity,
        int semanticRefOrdinal,
        CancellationToken cancellationToken = default
    )
    {
        KnowProVerify.ThrowIfInvalid(entity);

        // TODO: Bulk operations

        await propertyIndex.AddPropertyAsync(
            KnowledgePropertyName.EntityName,
            entity.Name,
            semanticRefOrdinal,
            cancellationToken
        );
        foreach (var type in entity.Type)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.EntityType,
                type,
                semanticRefOrdinal,
                cancellationToken
            );
        }
        // add every facet name as a separate term
        if (entity.HasFacets)
        {
            foreach (var facet in entity.Facets)
            {
                await propertyIndex.AddFacetAsync(facet, semanticRefOrdinal, cancellationToken);
            }
        }

    }

    public static async Task AddFacetAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        Facet facet,
        int semanticRefOrdinal,
        CancellationToken cancellationToken
    )
    {
        // TODO: Bulk operations
        await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.FacetName,
                facet.Name,
                semanticRefOrdinal,
                cancellationToken
            );
        if (facet.Value is not null)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.FacetValue,
                facet.Value.ToString(),
                semanticRefOrdinal,
                cancellationToken
            );
        }
    }

}
