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
    public static Task AddPropertyAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        string propertyName, string value,
        int semanticRefOrdinal,
        CancellationToken cancellationToken = default
    )
    {
        return propertyIndex.AddPropertyAync(propertyName, value, ScoredSemanticRefOrdinal.New(semanticRefOrdinal), cancellationToken);
    }

    public static async Task AddSemanticRefAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        SemanticRef semanticRef,
        CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNull(semanticRef, nameof(semanticRef));

        switch(semanticRef.KnowledgeType)
        {
            default:
                break;

            case KnowledgeType.Entity:
                await propertyIndex.AddEntityPropertiesAsync(
                    semanticRef.Knowledge as ConcreteEntity,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                ).ConfigureAwait(false);
                break;
        }
    }

    public static async Task AddSemanticRefsAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        IEnumerable<SemanticRef> semanticRefs,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(semanticRefs, nameof(semanticRefs));

        // TODO: Bulk operations
        foreach(var semanticRef in semanticRefs)
        {
            await propertyIndex.AddSemanticRefAsync(semanticRef, cancellationToken);
        }
    }

    public static async Task AddEntityPropertiesAsync(
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
        ).ConfigureAwait(false);

        foreach (var type in entity.Type)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.EntityType,
                type,
                semanticRefOrdinal,
                cancellationToken
            ).ConfigureAwait(false);
        }

        // add every facet name as a separate term
        if (entity.HasFacets)
        {
            foreach (var facet in entity.Facets)
            {
                await propertyIndex.AddFacetAsync(facet, semanticRefOrdinal, cancellationToken).ConfigureAwait(false);
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
        ).ConfigureAwait(false);

        if (facet.Value is not null)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.FacetValue,
                facet.Value.ToString(),
                semanticRefOrdinal,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

}
